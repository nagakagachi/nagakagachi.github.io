use crate::{
    gpu::*,
    profiler::GpuProfiler,
    scene::{self, Camera, Settings},
};
use bytemuck::{Pod, Zeroable};
use wgpu::{BufferUsages as B, ShaderStages as S, TextureUsages as T};

const SOURCE: &str = include_str!("shaders/volumetric-fog.wgsl");
const COMMON: &str = include_str!("shaders/polar-shadow-common.wgsl");

#[derive(Clone, PartialEq)]
pub struct FogSettings {
    pub enabled: bool,
    pub shadow: bool,
    pub density: f32,
    pub distance: f32,
    pub anisotropy: f32,
    pub steps: u32,
    pub divisor: u32,
}
impl Default for FogSettings {
    fn default() -> Self {
        Self {
            enabled: true,
            shadow: true,
            density: 0.00010,
            distance: 16000.0,
            anisotropy: 0.02,
            steps: 16,
            divisor: 2,
        }
    }
}
#[repr(C)]
#[derive(Clone, Copy, Pod, Zeroable)]
struct Parameters {
    rays: [[f32; 4]; 3],
    sun: [f32; 4],
    source: [f32; 4],
    medium: [f32; 4],
    options: [u32; 4],
}

pub struct VolumetricFog {
    params: wgpu::Buffer,
    integrate: [wgpu::ComputePipeline; 2],
    composite: wgpu::RenderPipeline,
    build_group: wgpu::BindGroup,
    composite_group: wgpu::BindGroup,
    size: [u32; 2],
}
impl VolumetricFog {
    pub fn new(
        d: &wgpu::Device,
        depth: &wgpu::Texture,
        polar: &wgpu::BindGroupLayout,
    ) -> Self {
        let params = buffer(
            d,
            "Volumetric Fog パラメータ",
            std::mem::size_of::<Parameters>() as u64,
            B::UNIFORM | B::COPY_DST,
        );
        let depth_type = wgpu::BindingType::Texture {
            sample_type: wgpu::TextureSampleType::Depth,
            view_dimension: wgpu::TextureViewDimension::D2,
            multisampled: false,
        };
        let sampled = wgpu::BindingType::Texture {
            sample_type: wgpu::TextureSampleType::Float { filterable: false },
            view_dimension: wgpu::TextureViewDimension::D2,
            multisampled: false,
        };
        let storage = |format| wgpu::BindingType::StorageTexture {
            access: wgpu::StorageTextureAccess::WriteOnly,
            format,
            view_dimension: wgpu::TextureViewDimension::D2,
        };
        let build_layout = layout(
            d,
            &[
                (0, S::COMPUTE, uniform()),
                (1, S::COMPUTE, depth_type),
                (2, S::COMPUTE, storage(wgpu::TextureFormat::Rgba16Float)),
                (3, S::COMPUTE, storage(wgpu::TextureFormat::R32Float)),
            ],
        );
        let composite_layout = layout(
            d,
            &[
                (0, S::FRAGMENT, uniform()),
                (1, S::FRAGMENT, depth_type),
                (2, S::FRAGMENT, sampled),
                (3, S::FRAGMENT, sampled),
            ],
        );
        let fragment_source =
            SOURCE.replace("//CACHE_VARIANT", "const FOG_FULL_DISK: bool = false;");
        let module = shader(d, "Volumetric Fog", &[COMMON, &fragment_source]);
        let pl = d.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some("Volumetric Fog"),
            bind_group_layouts: &[&build_layout, polar],
            push_constant_ranges: &[],
        });
        // マッピングはパイプライン生成時の定数。ループは常に一つのPSCを参照する。
        let integrate = [true, false].map(|full_disk| {
            let source = SOURCE.replace(
                "//CACHE_VARIANT",
                if full_disk {
                    "const FOG_FULL_DISK: bool = true;"
                } else {
                    "const FOG_FULL_DISK: bool = false;"
                },
            );
            let module = shader(d, "Volumetric Fog 積分", &[COMMON, &source]);
            compute(
                d,
                if full_disk { "Fog Full Disk" } else { "Fog View-Fitted" },
                &module,
                "integrateFog",
                Some(&pl),
            )
        });
        let pl = d.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some("Volumetric Fog HDR合成"),
            bind_group_layouts: &[&composite_layout],
            push_constant_ranges: &[],
        });
        // RGBは散乱光+背景*透過率。Alphaを透過率としてHDRへ固定機能ブレンドする。
        let composite = d.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label: Some("Volumetric Fog HDR合成"),
            layout: Some(&pl),
            vertex: wgpu::VertexState {
                module: &module,
                entry_point: Some("fogVertex"),
                compilation_options: Default::default(),
                buffers: &[],
            },
            fragment: Some(wgpu::FragmentState {
                module: &module,
                entry_point: Some("compositeFog"),
                compilation_options: Default::default(),
                targets: &[Some(wgpu::ColorTargetState {
                    format: wgpu::TextureFormat::Rgba16Float,
                    blend: Some(wgpu::BlendState {
                        color: wgpu::BlendComponent {
                            src_factor: wgpu::BlendFactor::One,
                            dst_factor: wgpu::BlendFactor::SrcAlpha,
                            operation: wgpu::BlendOperation::Add,
                        },
                        alpha: wgpu::BlendComponent::REPLACE,
                    }),
                    write_mask: wgpu::ColorWrites::RED
                        | wgpu::ColorWrites::GREEN
                        | wgpu::ColorWrites::BLUE,
                })],
            }),
            primitive: Default::default(),
            depth_stencil: None,
            multisample: Default::default(),
            multiview: None,
            cache: None,
        });
        let (build_group, composite_group) =
            Self::targets(d, depth, &params, &build_layout, &composite_layout, [1, 1]);
        Self {
            params,
            integrate,
            composite,
            build_group,
            composite_group,
            size: [1, 1],
        }
    }
    fn targets(
        d: &wgpu::Device,
        depth: &wgpu::Texture,
        params: &wgpu::Buffer,
        build: &wgpu::BindGroupLayout,
        composite: &wgpu::BindGroupLayout,
        size: [u32; 2],
    ) -> (wgpu::BindGroup, wgpu::BindGroup) {
        let color = texture(
            d,
            "Volumetric Fog 散乱光・透過率",
            size,
            wgpu::TextureFormat::Rgba16Float,
            T::STORAGE_BINDING | T::TEXTURE_BINDING,
            1,
        )
        .create_view(&Default::default());
        let guide = texture(
            d,
            "Volumetric Fog 拡大用深度",
            size,
            wgpu::TextureFormat::R32Float,
            T::STORAGE_BINDING | T::TEXTURE_BINDING,
            1,
        )
        .create_view(&Default::default());
        let depth = depth.create_view(&Default::default());
        let bindings = [
            params.as_entire_binding(),
            wgpu::BindingResource::TextureView(&depth),
            wgpu::BindingResource::TextureView(&color),
            wgpu::BindingResource::TextureView(&guide),
        ];
        (group(d, build, &bindings), group(d, composite, &bindings))
    }
    pub fn rebuild(
        &mut self,
        d: &wgpu::Device,
        depth: &wgpu::Texture,
        size: [u32; 2],
        divisor: u32,
    ) {
        let size = size.map(|v| v.div_ceil(divisor));
        (self.build_group, self.composite_group) = Self::targets(
            d,
            depth,
            &self.params,
            &self.integrate[0].get_bind_group_layout(0),
            &self.composite.get_bind_group_layout(0),
            size,
        );
        self.size = size;
    }
    pub fn prepare(
        &mut self,
        d: &wgpu::Device,
        depth: &wgpu::Texture,
        size: [u32; 2],
        divisor: u32,
    ) {
        if self.size != size.map(|v| v.div_ceil(divisor)) {
            self.rebuild(d, depth, size, divisor);
        }
    }
    pub fn encode(
        &self,
        q: &wgpu::Queue,
        e: &mut wgpu::CommandEncoder,
        s: &Settings,
        c: &Camera,
        aspect: f32,
        hdr: &wgpu::TextureView,
        polar: &wgpu::BindGroup,
        timer: &mut GpuProfiler,
    ) {
        let o = &s.fog;
        let parameters = Parameters {
            rays: c.rays(aspect, s.fov),
            sun: scene::light(s).extend(0.0).to_array(),
            // 太陽放射はサーフェイスと同じ20。PreExposureはここで一度だけ適用する。
            source: [if s.direct {
                20.0 * 2f32.powf(-s.ev)
            } else {
                0.0
            }; 4],
            medium: [o.density, o.distance, o.anisotropy, 0.9],
            options: [o.steps, u32::from(o.shadow && s.polar.enabled), 0, 0],
        };
        q.write_buffer(&self.params, 0, bytemuck::bytes_of(&parameters));
        {
            let mut pass = e.begin_compute_pass(&wgpu::ComputePassDescriptor {
                label: Some("Volumetric Fog 積分"),
                timestamp_writes: timer.compute_writes(match s.polar.mapping {
                    crate::polar_shadow::Mapping::FullDisk => "Volumetric Fog Full Disk",
                    crate::polar_shadow::Mapping::ViewFitted => "Volumetric Fog View-Fitted",
                }),
            });
            pass.set_pipeline(&self.integrate[s.polar.mapping.index()]);
            pass.set_bind_group(0, &self.build_group, &[]);
            pass.set_bind_group(1, polar, &[]);
            pass.dispatch_workgroups(self.size[0].div_ceil(8), self.size[1].div_ceil(8), 1);
        }
        let mut pass = e.begin_render_pass(&wgpu::RenderPassDescriptor {
            label: Some("Volumetric Fog HDR合成"),
            color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                view: hdr,
                depth_slice: None,
                resolve_target: None,
                ops: wgpu::Operations {
                    load: wgpu::LoadOp::Load,
                    store: wgpu::StoreOp::Store,
                },
            })],
            depth_stencil_attachment: None,
            timestamp_writes: timer.render_writes("Volumetric Fog HDR合成"),
            occlusion_query_set: None,
        });
        pass.set_pipeline(&self.composite);
        pass.set_bind_group(0, &self.composite_group, &[]);
        pass.draw(0..3, 0..1);
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn fog_shader_validates() {
        for variant in [
            "const FOG_FULL_DISK: bool = true;",
            "const FOG_FULL_DISK: bool = false;",
        ] {
            let source = super::SOURCE.replace("//CACHE_VARIANT", variant);
            let module = naga::front::wgsl::parse_str(&[super::COMMON, &source].join("\n"))
                .expect("Fog WGSL構文");
            naga::valid::Validator::new(
                naga::valid::ValidationFlags::all(),
                naga::valid::Capabilities::all(),
            )
            .validate(&module)
            .expect("Fog WGSL検証");
        }
    }
    #[test]
    fn quadratic_march_segments_cover_the_distance() {
        // V等間隔の非等間隔積分でも、均一媒質の透過率は解析解と一致する。
        for steps in [8, 16, 32] {
            let mut result = 1.0f64;
            for i in 0..steps {
                let a = i as f64 / steps as f64;
                let b = (i + 1) as f64 / steps as f64;
                result *= (-0.00015 * 8000.0 * (b * b - a * a)).exp();
            }
            assert!((result - (-1.2f64).exp()).abs() < 1e-12);
        }
    }
    #[test]
    fn recurrent_march_preserves_depth_and_transmittance() {
        // 二乗距離を差分更新しても、比較深度と均一媒質の解析解を保つ。
        for steps in [8, 16, 32] {
            for (start, end, distance) in [(0.0f32, 8000.0f32, 8000.0f32), (256.0, 4000.0, 16000.0)]
            {
                let sigma = 0.00015f32;
                let a = (end - start) / ((steps * steps) as f32);
                let jitter = 0.73f32;
                let slope = -1.0f32 / 32000.0;
                let mut z = slope * (start + a * jitter * jitter);
                let mut dz = slope * a * (2.0 * jitter + 1.0);
                let mut segment = (-sigma * a).exp();
                let ratio = (-2.0 * sigma * a).exp();
                let mut t = (-sigma * start).exp();
                let mut scatter = 1.0 - t;
                for i in 0..steps {
                    let reference = slope * (start + a * (i as f32 + jitter).powi(2));
                    assert!((z - reference).abs() < 1e-6);
                    scatter += t * (1.0 - segment);
                    t *= segment;
                    segment *= ratio;
                    z += dz;
                    dz += 2.0 * slope * a;
                }
                let suffix = (-sigma * (distance - end)).exp();
                scatter += t * (1.0 - suffix);
                t *= suffix;
                assert!((t - (-sigma * distance).exp()).abs() < 2e-5);
                assert!((scatter + t - 1.0).abs() < 2e-5);
            }
        }
    }
}
