use crate::{
    gpu::*,
    scene::{Camera, Settings, light},
};
use wgpu::{BufferUsages as B, TextureUsages as T};
const ATM: &str = include_str!("shaders/atmosphere.wgsl");
const SKY: &str = include_str!("shaders/sky-common.wgsl");
const OCT: &str = include_str!("shaders/sky-octahedral.wgsl");
const SH: &str = include_str!("shaders/sky-sh.wgsl");
const CAM: &str = include_str!("shaders/camera.wgsl");
const PBR: &str = include_str!("shaders/pbr.wgsl");
const SAMPLES: &str = include_str!("shaders/ibl-sampling.wgsl");
pub struct Sky {
    pub map: wgpu::Texture,
    pub specular: wgpu::Texture,
    pub lut: wgpu::Texture,
    pub sh: wgpu::Buffer,
    pub sampler: wgpu::Sampler,
    params: wgpu::Buffer,
    rays: wgpu::Buffer,
    pipelines: Vec<wgpu::ComputePipeline>,
    groups: Vec<wgpu::BindGroup>,
    prefilter: wgpu::ComputePipeline,
    filters: Vec<wgpu::BindGroup>,
    brdf: wgpu::ComputePipeline,
    brdf_group: wgpu::BindGroup,
    pub render: wgpu::RenderPipeline,
    pub render_group: wgpu::BindGroup,
    key: Option<[u32; 4]>,
    initialized: bool,
}
impl Sky {
    pub fn new(d: &wgpu::Device, camera: &wgpu::Buffer) -> Self {
        let usage = T::STORAGE_BINDING | T::TEXTURE_BINDING | T::COPY_SRC;
        let map = texture(
            d,
            "Sky Octahedral",
            [256, 256],
            wgpu::TextureFormat::Rgba16Float,
            usage,
            1,
        );
        let specular = texture(
            d,
            "GGX Octahedral",
            [256, 256],
            wgpu::TextureFormat::Rgba16Float,
            usage,
            5,
        );
        let lut = texture(
            d,
            "BRDF LUT",
            [128, 128],
            wgpu::TextureFormat::Rgba16Float,
            usage,
            1,
        );
        let sh = buffer(d, "SH二次9係数", 144, B::STORAGE | B::UNIFORM | B::COPY_SRC);
        let partials = buffer(d, "SH投影中間集計", 1024 * 9 * 16, B::STORAGE);
        let params = buffer(d, "Sky条件", 32, B::UNIFORM | B::COPY_DST);
        let rays = buffer(d, "Sky ray基底", 48, B::UNIFORM | B::COPY_DST);
        let pipelines = vec![
            compute(
                d,
                "Sky",
                &shader(
                    d,
                    "sky-generate",
                    &[ATM, SKY, OCT, include_str!("shaders/sky-generate.wgsl")],
                ),
                "generateSky",
                None,
            ),
            compute(
                d,
                "SH投影",
                &shader(
                    d,
                    "sky-project",
                    &[OCT, SH, include_str!("shaders/sky-project.wgsl")],
                ),
                "projectSky",
                None,
            ),
            compute(
                d,
                "SH集約",
                &shader(
                    d,
                    "sky-reduce",
                    &[SH, include_str!("shaders/sky-reduce.wgsl")],
                ),
                "reduceSky",
                None,
            ),
        ];
        let mv = map.create_view(&Default::default());
        let groups = vec![
            group(
                d,
                &pipelines[0].get_bind_group_layout(0),
                &[
                    params.as_entire_binding(),
                    wgpu::BindingResource::TextureView(&mv),
                ],
            ),
            group(
                d,
                &pipelines[1].get_bind_group_layout(0),
                &[
                    wgpu::BindingResource::TextureView(&mv),
                    partials.as_entire_binding(),
                ],
            ),
            group(
                d,
                &pipelines[2].get_bind_group_layout(0),
                &[partials.as_entire_binding(), sh.as_entire_binding()],
            ),
        ];
        let prefilter = compute(
            d,
            "GGX Prefilter",
            &shader(
                d,
                "ibl-prefilter",
                &[
                    PBR,
                    SAMPLES,
                    OCT,
                    include_str!("shaders/ibl-prefilter.wgsl"),
                ],
            ),
            "prefilterMain",
            None,
        );
        let filters = (0..5)
            .map(|mip| {
                let rough = upload(d, "Mip粗さ", &[mip as f32 / 4., 0., 0., 0.], B::UNIFORM);
                let view = specular.create_view(&wgpu::TextureViewDescriptor {
                    base_mip_level: mip,
                    mip_level_count: Some(1),
                    ..Default::default()
                });
                group(
                    d,
                    &prefilter.get_bind_group_layout(0),
                    &[
                        wgpu::BindingResource::TextureView(&mv),
                        wgpu::BindingResource::TextureView(&view),
                        rough.as_entire_binding(),
                    ],
                )
            })
            .collect();
        let brdf = compute(
            d,
            "BRDF積分",
            &shader(
                d,
                "ibl-brdf",
                &[PBR, SAMPLES, include_str!("shaders/ibl-brdf.wgsl")],
            ),
            "integrateBRDF",
            None,
        );
        let lv = lut.create_view(&Default::default());
        let brdf_group = group(
            d,
            &brdf.get_bind_group_layout(0),
            &[wgpu::BindingResource::TextureView(&lv)],
        );
        let sampler = d.create_sampler(&wgpu::SamplerDescriptor {
            min_filter: wgpu::FilterMode::Linear,
            mag_filter: wgpu::FilterMode::Linear,
            mipmap_filter: wgpu::FilterMode::Linear,
            ..Default::default()
        });
        let module = shader(
            d,
            "Sky表示",
            &[ATM, SKY, CAM, include_str!("shaders/sky-render.wgsl")],
        );
        let l = layout(
            d,
            &[
                (0, wgpu::ShaderStages::FRAGMENT, uniform()),
                (1, wgpu::ShaderStages::FRAGMENT, uniform()),
                (2, wgpu::ShaderStages::FRAGMENT, uniform()),
            ],
        );
        let render = pipeline(
            d,
            "Sky pixel ray",
            &module,
            "skyVertex",
            Some("skyFragment"),
            &[&l],
            wgpu::TextureFormat::Rgba16Float,
            Some((wgpu::CompareFunction::GreaterEqual, false)),
            wgpu::PrimitiveTopology::TriangleList,
            None,
        );
        let render_group = group(
            d,
            &l,
            &[
                params.as_entire_binding(),
                rays.as_entire_binding(),
                camera.as_entire_binding(),
            ],
        );
        Self {
            map,
            specular,
            lut,
            sh,
            sampler,
            params,
            rays,
            pipelines,
            groups,
            prefilter,
            filters,
            brdf,
            brdf_group,
            render,
            render_group,
            key: None,
            initialized: false,
        }
    }
    pub fn encode(
        &mut self,
        q: &wgpu::Queue,
        e: &mut wgpu::CommandEncoder,
        s: &Settings,
        c: &Camera,
        aspect: f32,
    ) {
        q.write_buffer(&self.rays, 0, bytemuck::cast_slice(&c.rays(aspect, s.fov)));
        let l = light(s);
        let altitude = (c.position.y + 2000.).max(2.);
        let key = [
            l.x.to_bits(),
            l.y.to_bits(),
            l.z.to_bits(),
            altitude.to_bits(),
        ];
        if !self.initialized {
            let mut p = e.begin_compute_pass(&wgpu::ComputePassDescriptor {
                label: Some("BRDF LUT"),
                timestamp_writes: None,
            });
            p.set_pipeline(&self.brdf);
            p.set_bind_group(0, &self.brdf_group, &[]);
            p.dispatch_workgroups(16, 16, 1);
            self.initialized = true;
        }
        if self.key == Some(key) {
            return;
        }
        self.key = Some(key);
        q.write_buffer(
            &self.params,
            0,
            bytemuck::cast_slice(&[l.x, l.y, l.z, 0., altitude, 0., 0., 0.]),
        );
        for i in 0..3 {
            let mut p = e.begin_compute_pass(&wgpu::ComputePassDescriptor {
                label: Some(["Sky Octahedral", "SH投影", "SH集約"][i]),
                timestamp_writes: None,
            });
            p.set_pipeline(&self.pipelines[i]);
            p.set_bind_group(0, &self.groups[i], &[]);
            let (x, y) = [(32, 32), (1024, 1), (1, 1)][i];
            p.dispatch_workgroups(x, y, 1);
        }
        let mut p = e.begin_compute_pass(&wgpu::ComputePassDescriptor {
            label: Some("GGX Octahedral Prefilter"),
            timestamp_writes: None,
        });
        p.set_pipeline(&self.prefilter);
        for (i, g) in self.filters.iter().enumerate() {
            p.set_bind_group(0, g, &[]);
            let n = (256u32 >> i).div_ceil(8);
            p.dispatch_workgroups(n, n, 1);
        }
    }
}
pub fn shading() -> String {
    [SH, ATM, CAM, PBR, OCT].join("\n")
}
