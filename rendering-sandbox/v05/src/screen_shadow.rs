use crate::{
    gpu::*,
    profiler::GpuProfiler,
    scene::{Camera, Settings as SceneSettings},
};
use bytemuck::{Pod, Zeroable};
use std::sync::{Arc, Mutex};
use wgpu::{BufferUsages as B, ShaderStages as S, TextureUsages as T};
pub const PARAMS: &str = include_str!("shaders/screen-shadow-params.wgsl");
pub const FORWARD: &str = include_str!("shaders/screen-shadow-forward.wgsl");

#[derive(Clone, PartialEq)]
pub struct Settings {
    pub enabled: bool,
    pub divisor: u32,
    pub steps: u32,
    pub length: f32,
    pub thickness: f32,
    pub bias: f32,
    pub counters: bool,
    pub mode: u32,
    pub debug: u32,
    pub bilinear: bool,
    pub jitter: bool,
    pub adaptive: bool,
    pub reference_distance: f32,
    pub max_length: f32,
    pub max_thickness: f32,
    pub contact_step: f32,
    pub contact_steps: u32,
    pub step_thickness: f32,
}
impl Default for Settings {
    fn default() -> Self {
        Self {
            enabled: true,
            divisor: 1,
            steps: 16,
            length: 64.,
            thickness: 0.2,
            bias: 0.02,
            counters: false,
            mode: 0,
            debug: 0,
            bilinear: false,
            jitter: true,
            adaptive: true,
            reference_distance: 128.,
            max_length: 8192.,
            max_thickness: 256.,
            contact_step: 0.25,
            contact_steps: 4,
            step_thickness: 0.5,
        }
    }
}
#[repr(C)]
#[derive(Clone, Copy, Pod, Zeroable)]
struct Params {
    inverse: [[f32; 4]; 4],
    matrix: [[f32; 4]; 4],
    light: [f32; 4],
    trace: [f32; 4],
    dimensions: [u32; 4],
    options: [u32; 4],
    display: [u32; 4],
    adaptive: [f32; 4],
    contact: [f32; 4],
}
pub fn dimensions(full: [u32; 2], divisor: u32) -> [u32; 2] {
    let d = divisor.max(1);
    [full[0].div_ceil(d).max(1), full[1].div_ceil(d).max(1)]
}
pub struct ScreenShadow {
    pub mask: wgpu::Texture,
    pub uniform: wgpu::Buffer,
    pub size: [u32; 2],
    pub divisor: u32,
    pub counts: Option<[u32; 4]>,
    pub counted_frame: u64,
    pipeline: wgpu::ComputePipeline,
    trace_group: wgpu::BindGroup,
    pub debug_pipeline: wgpu::RenderPipeline,
    pub debug_group: wgpu::BindGroup,
    totals: wgpu::Buffer,
    readback: wgpu::Buffer,
    pending: bool,
    needs_map: bool,
    submitted_frame: u64,
    result: Arc<Mutex<Option<Result<(), wgpu::BufferAsyncError>>>>,
}
impl ScreenShadow {
    pub fn new(d: &wgpu::Device, depth: &wgpu::Texture, full: [u32; 2]) -> Self {
        let divisor = Settings::default().divisor;
        let size = dimensions(full, divisor);
        let mask = make_mask(d, size);
        let uniform = buffer(
            d,
            "Screen Shadow Params",
            std::mem::size_of::<Params>() as u64,
            B::UNIFORM | B::COPY_DST,
        );
        let totals = buffer(
            d,
            "Screen Shadow診断集計",
            16,
            B::STORAGE | B::COPY_SRC | B::COPY_DST,
        );
        let readback = buffer(d, "Screen Shadow非同期診断", 16, B::MAP_READ | B::COPY_DST);
        let module = shader(
            d,
            "単純Screen Space Shadow",
            &[PARAMS, include_str!("shaders/screen-shadow-trace.wgsl")],
        );
        let ll = layout(
            d,
            &[
                (0, S::COMPUTE, crate::gpu::uniform()),
                (1, S::COMPUTE, depth_binding()),
                (
                    2,
                    S::COMPUTE,
                    wgpu::BindingType::StorageTexture {
                        access: wgpu::StorageTextureAccess::WriteOnly,
                        format: wgpu::TextureFormat::Rgba8Unorm,
                        view_dimension: wgpu::TextureViewDimension::D2,
                    },
                ),
                (3, S::COMPUTE, storage(false)),
            ],
        );
        let pl = d.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some("Screen Shadow Trace"),
            bind_group_layouts: &[&ll],
            push_constant_ranges: &[],
        });
        let pipeline = d.create_compute_pipeline(&wgpu::ComputePipelineDescriptor {
            label: Some("Screen Shadow Trace"),
            layout: Some(&pl),
            module: &module,
            entry_point: Some("traceMain"),
            compilation_options: Default::default(),
            cache: None,
        });
        let trace_group = trace_group(d, &ll, &uniform, depth, &mask, &totals);
        let dl = layout(
            d,
            &[
                (0, S::FRAGMENT, mask_binding()),
                (1, S::FRAGMENT, crate::gpu::uniform()),
            ],
        );
        let dm = shader(
            d,
            "Screen Shadow可視化",
            &[PARAMS, include_str!("shaders/screen-shadow-debug.wgsl")],
        );
        let debug_pipeline = pipeline_debug(d, &dm, &dl);
        let debug_group = group(
            d,
            &dl,
            &[
                wgpu::BindingResource::TextureView(&mask.create_view(&Default::default())),
                uniform.as_entire_binding(),
            ],
        );
        Self {
            mask,
            uniform,
            size,
            divisor,
            counts: None,
            counted_frame: 0,
            pipeline,
            trace_group,
            debug_pipeline,
            debug_group,
            totals,
            readback,
            pending: false,
            needs_map: false,
            submitted_frame: 0,
            result: Default::default(),
        }
    }
    pub fn rebuild(
        &mut self,
        d: &wgpu::Device,
        depth: &wgpu::Texture,
        full: [u32; 2],
        divisor: u32,
    ) {
        self.divisor = divisor;
        self.size = dimensions(full, divisor);
        self.mask = make_mask(d, self.size);
        self.trace_group = trace_group(
            d,
            &self.pipeline.get_bind_group_layout(0),
            &self.uniform,
            depth,
            &self.mask,
            &self.totals,
        );
        self.debug_group = group(
            d,
            &self.debug_pipeline.get_bind_group_layout(0),
            &[
                wgpu::BindingResource::TextureView(&self.mask.create_view(&Default::default())),
                self.uniform.as_entire_binding(),
            ],
        );
        self.counts = None;
    }
    pub fn encode(
        &mut self,
        q: &wgpu::Queue,
        e: &mut wgpu::CommandEncoder,
        s: &SceneSettings,
        c: &Camera,
        full: [u32; 2],
        frame: u64,
        timer: &mut GpuProfiler,
    ) {
        let v = &s.screen_shadow;
        let matrix = c.matrix(full[0] as f32 / full[1] as f32, s.fov);
        let data = Params {
            inverse: matrix.inverse().to_cols_array_2d(),
            matrix: matrix.to_cols_array_2d(),
            light: crate::scene::light(s).extend(0.).to_array(),
            trace: [v.length, v.thickness, v.bias, 0.],
            dimensions: [full[0], full[1], self.size[0], self.size[1]],
            options: [
                v.enabled as u32,
                v.steps.clamp(1, 16),
                v.counters as u32,
                v.mode,
            ],
            display: [v.debug, v.bilinear as u32, 0, v.jitter as u32],
            adaptive: [
                v.adaptive as u32 as f32,
                v.reference_distance.max(1.),
                v.max_length.max(v.length),
                v.max_thickness.max(v.thickness),
            ],
            contact: [
                v.contact_step.max(0.001),
                v.contact_steps.min(8) as f32,
                v.step_thickness,
                0.,
            ],
        };
        q.write_buffer(&self.uniform, 0, bytemuck::bytes_of(&data));
        if !v.enabled {
            return;
        }
        if v.counters {
            e.clear_buffer(&self.totals, 0, None);
        }
        {
            let mut pass = e.begin_compute_pass(&wgpu::ComputePassDescriptor {
                label: Some("Screen Shadow Trace"),
                timestamp_writes: timer.compute_writes("Screen Shadow Trace"),
            });
            pass.set_pipeline(&self.pipeline);
            pass.set_bind_group(0, &self.trace_group, &[]);
            pass.dispatch_workgroups(self.size[0].div_ceil(8), self.size[1].div_ceil(8), 1);
        }
        if v.counters && !self.pending {
            e.copy_buffer_to_buffer(&self.totals, 0, &self.readback, 0, 16);
            self.pending = true;
            self.needs_map = true;
            self.submitted_frame = frame;
        }
    }
    pub fn submitted(&mut self, wake: impl Fn() + Send + Sync + 'static) {
        if !self.needs_map {
            return;
        }
        self.needs_map = false;
        let result = self.result.clone();
        self.readback
            .slice(..)
            .map_async(wgpu::MapMode::Read, move |r| {
                *result.lock().expect("診断結果ロック") = Some(r);
                wake();
            });
    }
    pub fn collect(&mut self) {
        let r = self.result.lock().expect("診断結果ロック").take();
        if let Some(r) = r {
            if r.is_ok() {
                let data = self.readback.slice(..).get_mapped_range();
                self.counts = Some(
                    bytemuck::cast_slice::<u8, u32>(&data)[..4]
                        .try_into()
                        .expect("4項目"),
                );
                self.counted_frame = self.submitted_frame;
                drop(data);
                self.readback.unmap();
            }
            self.pending = false;
        }
    }
    #[cfg(not(target_arch = "wasm32"))]
    pub fn pending(&self) -> bool {
        self.pending
    }
}
pub fn mask_binding() -> wgpu::BindingType {
    wgpu::BindingType::Texture {
        sample_type: wgpu::TextureSampleType::Float { filterable: false },
        view_dimension: wgpu::TextureViewDimension::D2,
        multisampled: false,
    }
}
fn depth_binding() -> wgpu::BindingType {
    wgpu::BindingType::Texture {
        sample_type: wgpu::TextureSampleType::Depth,
        view_dimension: wgpu::TextureViewDimension::D2,
        multisampled: false,
    }
}
fn make_mask(d: &wgpu::Device, size: [u32; 2]) -> wgpu::Texture {
    // 全体可視率・参照数・終了理由・コンタクト可視率を1枚4bytesへ格納する。
    texture(
        d,
        "Screen Shadow Mask RGBA8",
        size,
        wgpu::TextureFormat::Rgba8Unorm,
        T::STORAGE_BINDING | T::TEXTURE_BINDING | T::COPY_SRC,
        1,
    )
}
fn trace_group(
    d: &wgpu::Device,
    ll: &wgpu::BindGroupLayout,
    u: &wgpu::Buffer,
    depth: &wgpu::Texture,
    mask: &wgpu::Texture,
    t: &wgpu::Buffer,
) -> wgpu::BindGroup {
    group(
        d,
        ll,
        &[
            u.as_entire_binding(),
            wgpu::BindingResource::TextureView(&depth.create_view(&Default::default())),
            wgpu::BindingResource::TextureView(&mask.create_view(&Default::default())),
            t.as_entire_binding(),
        ],
    )
}
fn pipeline_debug(
    d: &wgpu::Device,
    m: &wgpu::ShaderModule,
    ll: &wgpu::BindGroupLayout,
) -> wgpu::RenderPipeline {
    pipeline(
        d,
        "Screen Shadow Debug",
        m,
        "screenDebugVertex",
        Some("screenDebugFragment"),
        &[ll],
        wgpu::TextureFormat::Rgba8Unorm,
        None,
        wgpu::PrimitiveTopology::TriangleList,
        None,
    )
}

// 無人検証だけでGPU完了を待つ。既知の平面・遮蔽物で交差の有無と診断値を検査する。
#[cfg(not(target_arch = "wasm32"))]
pub fn verify_gpu(d: &wgpu::Device, q: &wgpu::Queue) -> Result<(), wgpu::PollError> {
    let depth = texture(
        d,
        "検証用深度",
        [64, 64],
        wgpu::TextureFormat::Depth32Float,
        T::RENDER_ATTACHMENT | T::TEXTURE_BINDING,
        1,
    );
    let mut screen = ScreenShadow::new(d, &depth, [64, 64]);
    screen.rebuild(d, &depth, [64, 64], 4);
    let code = "@vertex fn vs(@builtin(vertex_index) id:u32)->@builtin(position) vec4f {let p=array<vec2f,3>(vec2f(-1,-1),vec2f(3,-1),vec2f(-1,3));return vec4f(p[id],0.2,1);}";
    let module = shader(d, "検証用遮蔽物", &[code]);
    let pipeline = pipeline(
        d,
        "検証用深度書込",
        &module,
        "vs",
        None,
        &[],
        wgpu::TextureFormat::Rgba8Unorm,
        Some((wgpu::CompareFunction::Always, true)),
        wgpu::PrimitiveTopology::TriangleList,
        None,
    );
    let far_module = shader(
        d,
        "検証用遠景遮蔽物",
        &[&code.replace("0.2,1", "0.001030927835,1")],
    );
    let far_pipeline = crate::gpu::pipeline(
        d,
        "検証用遠景深度",
        &far_module,
        "vs",
        None,
        &[],
        wgpu::TextureFormat::Rgba8Unorm,
        Some((wgpu::CompareFunction::Always, true)),
        wgpu::PrimitiveTopology::TriangleList,
        None,
    );
    let mut settings = SceneSettings::default();
    settings.elevation = 0.;
    settings.azimuth = 90.;
    settings.screen_shadow.steps = 8;
    settings.screen_shadow.divisor = 4;
    settings.screen_shadow.counters = true;
    settings.screen_shadow.length = 4.;
    settings.screen_shadow.thickness = 6.;
    let camera = Camera {
        position: glam::Vec3::ZERO,
        ..Default::default()
    };
    let readback = buffer(d, "検証用マスク", 256 * 16, B::MAP_READ | B::COPY_DST);
    let mut timer = GpuProfiler::new(d, q);
    let mut saved = None;
    for case in 0..10 {
        let far = (6..=8).contains(&case);
        settings.screen_shadow.counters = case != 3;
        settings.screen_shadow.adaptive = case != 6 && case != 9;
        settings.screen_shadow.reference_distance = 10.;
        settings.screen_shadow.thickness = if far { 0.2 } else { 6. };
        settings.screen_shadow.step_thickness = if case == 8 { 0. } else { 0.5 };
        settings.screen_shadow.jitter = case != 4;
        let mut e = d.create_command_encoder(&Default::default());
        let view = depth.create_view(&Default::default());
        {
            let mut p = e.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: Some("既知の深度画像"),
                color_attachments: &[],
                depth_stencil_attachment: Some(wgpu::RenderPassDepthStencilAttachment {
                    view: &view,
                    depth_ops: Some(wgpu::Operations {
                        load: wgpu::LoadOp::Clear(if case == 0 {
                            0.
                        } else if far {
                            0.001
                        } else {
                            0.1
                        }),
                        store: wgpu::StoreOp::Store,
                    }),
                    stencil_ops: None,
                }),
                timestamp_writes: None,
                occlusion_query_set: None,
            });
            if case >= 2 {
                p.set_pipeline(if far { &far_pipeline } else { &pipeline });
                p.set_scissor_rect(28, 16, 8, 32);
                p.draw(0..3, 0..1);
            }
        }
        screen.encode(q, &mut e, &settings, &camera, [64, 64], case, &mut timer);
        e.copy_texture_to_buffer(
            wgpu::TexelCopyTextureInfo {
                texture: &screen.mask,
                mip_level: 0,
                origin: wgpu::Origin3d::ZERO,
                aspect: wgpu::TextureAspect::All,
            },
            wgpu::TexelCopyBufferInfo {
                buffer: &readback,
                layout: wgpu::TexelCopyBufferLayout {
                    offset: 0,
                    bytes_per_row: Some(256),
                    rows_per_image: Some(16),
                },
            },
            wgpu::Extent3d {
                width: 16,
                height: 16,
                depth_or_array_layers: 1,
            },
        );
        q.submit([e.finish()]);
        screen.submitted(|| {});
        let result = Arc::new(Mutex::new(None));
        let callback = result.clone();
        readback.slice(..).map_async(wgpu::MapMode::Read, move |r| {
            *callback.lock().unwrap() = Some(r);
        });
        d.poll(wgpu::PollType::wait_indefinitely())?;
        result
            .lock()
            .unwrap()
            .take()
            .expect("読戻し完了")
            .expect("マスク読戻し");
        screen.collect();
        let data = readback.slice(..).get_mapped_range();
        let pixels = (0..16)
            .flat_map(|y| data[y * 256..y * 256 + 64].to_vec())
            .collect::<Vec<_>>();
        if case < 2 {
            assert!(
                pixels.chunks_exact(4).all(|v| v[0] == 255),
                "空と単一平面には自己遮蔽がない"
            );
        }
        if case == 0 {
            assert_eq!(screen.counts, Some([0, 256, 0, 0]));
        }
        if case == 2 {
            let counts = screen.counts.expect("診断集計");
            assert!(
                counts[0] > 0 && counts[1] > 0 && counts[2] > 0,
                "既知の遮蔽物に交差する"
            );
            assert!(counts[1] <= 256 * 9);
            assert!(
                pixels.chunks_exact(4).any(|p| p[0] < 255 && p[3] < 255),
                "短い初期区間がコンタクト成分を保持"
            );
            saved = Some(pixels.clone());
        }
        if case == 3 {
            assert_eq!(
                saved.as_ref(),
                Some(&pixels),
                "診断のON/OFFでマスクを変えない"
            );
        }
        if case == 5 {
            assert_eq!(
                saved.as_ref(),
                Some(&pixels),
                "静的IGNはフレームが変わっても同じマスク"
            );
        }
        if case == 4 {
            assert!(
                screen.counts.unwrap()[2] > 0,
                "ジッターOFFでも既知の遮蔽物に交差"
            );
        }

        if case == 6 {
            assert!(
                pixels.chunks_exact(4).all(|p| p[0] == 255),
                "固定長・厚みでは遠景遮蔽物を拾わない"
            );
        }
        if case == 7 {
            assert!(
                screen.counts.unwrap()[2] > 0,
                "距離対応で遠景の遮蔽物を拾う"
            );
            assert!(
                pixels.chunks_exact(4).all(|p| p[3] == 255),
                "遠い交差は短距離マスクへ混入しない"
            );
        }
        if case == 8 {
            assert!(
                pixels.chunks_exact(4).all(|p| p[0] == 255),
                "区間厚み補正なしでは深い侵入を棄却"
            );
        }
        if case == 9 {
            assert!(
                screen.counts.unwrap()[2] > 0,
                "距離対応OFFでも近景のレイ全体を計算する"
            );
        }
        drop(data);
        readback.unmap();
    }
    Ok(())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn params_and_small_dimensions() {
        assert_eq!(std::mem::size_of::<Params>(), 240);
        assert_eq!(std::mem::offset_of!(Params, adaptive), 208);
        assert_eq!(std::mem::offset_of!(Params, contact), 224);
        assert_eq!(dimensions([1920, 1080], 4), [480, 270]);
        assert_eq!(dimensions([17, 9], 4), [5, 3]);
        assert_eq!(dimensions([1, 1], 4), [1, 1]);
    }
    #[test]
    fn shaders_validate() {
        for tail in [
            include_str!("shaders/screen-shadow-trace.wgsl"),
            include_str!("shaders/screen-shadow-debug.wgsl"),
        ] {
            let source = format!("{PARAMS}\n{tail}");
            let module = naga::front::wgsl::parse_str(&source).expect("Screen Shadow構文");
            naga::valid::Validator::new(
                naga::valid::ValidationFlags::all(),
                naga::valid::Capabilities::all(),
            )
            .validate(&module)
            .expect("Screen Shadow検査");
        }
    }
}
