use crate::{
    gpu::*,
    profiler::GpuProfiler,
    scene::{self, Camera, Settings as SceneSettings},
};
use bytemuck::{Pod, Zeroable};
use glam::Vec3;
use wgpu::{BufferUsages as B, ShaderStages as S, TextureUsages as T};

const COMMON: &str = include_str!("shaders/polar-shadow-common.wgsl");
const SOURCE: &str = include_str!("shaders/polar-shadow-build.wgsl");


#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Mapping { FullDisk, ViewFitted }
impl Mapping {
    pub fn label(self) -> &'static str { match self {
        Self::FullDisk => "Full Disk／全周", Self::ViewFitted => "View-Fitted／ビュー適合" } }
    pub fn index(self) -> usize { match self { Self::FullDisk => 0, Self::ViewFitted => 1 } }
}

#[derive(Clone, PartialEq)]
pub struct CacheSettings {
    pub enabled: bool,
    pub mapping: Mapping,
    pub inner_radius: f32,
    pub outer_radius: f32,
    pub inner_follow_csm: bool,
    pub caster_bias: bool,
    pub caster_bias_limit: f32,
    pub caster_bias_constant: f32,
    pub caster_bias_scale: f32,
    pub apply_shadow: bool,
    pub source_csm: bool,
    pub source_main_depth: bool,
    pub preserve_cache: bool,
    pub history_push_speed: f32,
    pub pcf: bool,
    pub receiver_bias: f32,
    pub distance: f32,
    pub world_debug: bool,
    pub xray: bool,
    pub offset: f32,
    pub overlay: bool,
    pub projected: bool,
    pub scale: f32,
    pub grid: bool,
    pub surface_grid: bool,
    pub size: [u32; 2],
}

#[cfg(test)]
mod tests {
    use super::*;

    fn limit(p: &Projection, theta: f32) -> f32 {
        let a = p.b.powi(2) * theta.cos().powi(2) + p.a.powi(2) * theta.sin().powi(2);
        let b = p.c * p.b.powi(2) * theta.cos();
        let c = p.b.powi(2) * (p.c.powi(2) - p.a.powi(2));
        ((b + (b * b - a * c).max(0.0).sqrt()) / a.max(1e-12)).max(0.0)
    }

    #[test]
    fn projection_covers_the_entire_view_cone() {
        let alpha = Projection::new(Vec3::X, Vec3::Z, 60.0, 16.0 / 9.0).alpha;
        // 直交、切替の両側、平行、反平行で円錐の最遠端をサンプリングする。
        for beta in [
            0.0,
            alpha - 0.001,
            alpha,
            alpha + 0.001,
            std::f32::consts::FRAC_PI_2,
            std::f32::consts::PI,
        ] {
            let forward = Vec3::new(beta.sin(), 0.0, beta.cos());
            let p = Projection::new(forward, Vec3::Z, 60.0, 16.0 / 9.0);
            for step in 0..360 {
                let angle = (step as f32).to_radians();
                let x = p.c + p.a * angle.cos();
                let y = p.b * angle.sin();
                let theta = y.atan2(x);
                let radius = x.hypot(y);
                assert!(theta.abs() <= p.half_angle + 0.002);
                assert!(radius <= limit(&p, theta) + 0.002);
            }
        }
    }

    #[test]
    fn aligned_view_is_a_disk_and_side_view_is_a_sector() {
        let aligned = Projection::new(Vec3::Z, Vec3::Z, 60.0, 1.0);
        assert_eq!(aligned.half_angle, std::f32::consts::PI);
        for theta in [0.0, 1.0, 2.0, 3.0] {
            assert!((limit(&aligned, theta) - aligned.b).abs() < 1e-5);
        }
        let side = Projection::new(Vec3::X, Vec3::Z, 60.0, 1.0);
        assert!((side.half_angle - side.alpha).abs() < 1e-5);
        assert!((limit(&side, 0.0) - 1.0).abs() < 1e-5);
        assert!((limit(&side, side.half_angle) - 1.0 / side.alpha.cos()).abs() < 1e-4);
    }

    #[test]
    fn shader_and_parameter_layout_are_valid() {
        let module =
            naga::front::wgsl::parse_str(&[COMMON, SOURCE].join("\n")).expect("PSCのWGSL構文");
        naga::valid::Validator::new(
            naga::valid::ValidationFlags::all(),
            naga::valid::Capabilities::all(),
        )
        .validate(&module)
        .expect("PSCのWGSL検証");
        assert_eq!(std::mem::size_of::<Parameters>(), 528);
        assert_eq!(std::mem::offset_of!(Parameters, flags), 496);
    }
}

impl CacheSettings {
    pub fn effective_inner(&self, csm_distance: f32) -> f32 {
        if self.mapping == Mapping::ViewFitted { return 0.0; }
        let inner = if self.inner_follow_csm { csm_distance } else { self.inner_radius };
        inner.clamp(0.0, self.outer_radius - 1.0)
    }
}
impl Default for CacheSettings {
    fn default() -> Self {
        Self {
            enabled: true,
            mapping: Mapping::FullDisk,
            inner_radius: 0.0,
            outer_radius: 16000.0,
            inner_follow_csm: true,
            caster_bias: true,
            caster_bias_limit: 100.0,
            caster_bias_constant: 0.0,
            caster_bias_scale: 1.0,
            apply_shadow: true,
            source_csm: false,
            source_main_depth: true,
            preserve_cache: true,
            history_push_speed: 20.0,
            pcf: true,
            receiver_bias: 0.0,
            distance: 16000.0,
            world_debug: false,
            xray: false,
            offset: 512.0,
            overlay: false,
            projected: true,
            scale: 1.0,
            grid: false,
            surface_grid: false,
            size: [1024; 2],
        }
    }
}

// 円錐の最遠端を投影した楕円と、円錐頂点との凸包を使う。
// 単位距離の楕円は中心(c,0)、長半径方向(a,b)。原点が内部なら全周になる。
pub struct Projection {
    pub c: f32,
    pub a: f32,
    pub b: f32,
    pub half_angle: f32,
    pub alpha: f32,
    pub beta: f32,
    pub extent: f32,
}

impl Projection {
    pub fn new(forward: Vec3, light: Vec3, fov: f32, aspect: f32) -> Self {
        let tangent = (0.5 * fov.to_radians()).tan() * (1.0 + aspect * aspect).sqrt();
        let alpha = tangent.atan();
        let cosine = forward.dot(light).abs().clamp(0.0, 1.0);
        let beta = forward.dot(light).clamp(-1.0, 1.0).acos();
        let c = (1.0 - cosine * cosine).max(0.0).sqrt();
        let a = tangent * cosine;
        let b = tangent;
        let half_angle = if c > a {
            (alpha.sin() / c).clamp(0.0, 1.0).asin()
        } else {
            std::f32::consts::PI
        };
        // 2D表示では全外形を正方形に収めるための保守的な半幅。
        let extent = (c + a).max(b);
        Self {
            c,
            a,
            b,
            half_angle,
            alpha,
            beta,
            extent,
        }
    }
}

#[repr(C)]
#[derive(Clone, Copy, Pod, Zeroable)]
struct Parameters {
    view_projection: [[f32; 4]; 4],
    inverse_view_projection: [[f32; 4]; 4],
    shadows: [[[f32; 4]; 4]; 4],
    camera: [f32; 4],
    right: [f32; 4],
    up: [f32; 4],
    light: [f32; 4],
    ellipse: [f32; 4],
    display: [f32; 4],
    mapping: [f32; 4],
    flags: [u32; 4],
    history: [f32; 4],
}

#[derive(PartialEq)]
struct HistoryKey {
    radii: [f32; 2],
    terrain: (u32, f32, f32),
    trees: (bool, f32),
    pillars: (bool, f32, f32, f32),
    caster_bias: (bool, f32, f32, f32),
}

pub struct PolarShadowCache {
    pub surface_layout: wgpu::BindGroupLayout,
    pub surface_group: wgpu::BindGroup,
    params: wgpu::Buffer,
    uniform_group: wgpu::BindGroup,
    source_group: wgpu::BindGroup,
    main_group: wgpu::BindGroup,
    depths: wgpu::Buffer,
    previous_depths: wgpu::Buffer,
    previous_params: wgpu::Buffer,
    last_params: Option<Parameters>,
    scatter: wgpu::ComputePipeline,
    reproject_history: wgpu::ComputePipeline,
    history_key: Option<HistoryKey>,
    output_group: wgpu::BindGroup,
    sample_group: wgpu::BindGroup,
    build: wgpu::ComputePipeline,
    world: [wgpu::RenderPipeline; 2],
    overlay: wgpu::RenderPipeline,
    previous_right: Vec3,
    size: [u32; 2],
}

impl PolarShadowCache {
    pub fn new(d: &wgpu::Device, csm: &wgpu::Texture, depth: &wgpu::Texture) -> Self {
        let params = buffer(
            d,
            "PSC パラメータ",
            std::mem::size_of::<Parameters>() as u64,
            B::UNIFORM | B::COPY_DST,
        );
        let uniforms = layout(d, &[(0, S::VERTEX_FRAGMENT | S::COMPUTE, uniform())]);
        let uniform_group = group(d, &uniforms, &[params.as_entire_binding()]);
        let source_layout = layout(
            d,
            &[(
                0,
                S::COMPUTE,
                wgpu::BindingType::Texture {
                    sample_type: wgpu::TextureSampleType::Depth,
                    view_dimension: wgpu::TextureViewDimension::D2,
                    multisampled: false,
                },
            )],
        );
        let source_group = group(
            d,
            &source_layout,
            &[wgpu::BindingResource::TextureView(
                &csm.create_view(&Default::default()),
            )],
        );
        let main_group = group(d, &source_layout, &[wgpu::BindingResource::TextureView(
            &depth.create_view(&Default::default()),
        )]);
        let depths = buffer(d, "PSC 深度集約", u64::from(1024u32 * 1024) * 4,
            B::STORAGE | B::COPY_DST | B::COPY_SRC);
        let previous_depths = buffer(d, "PSC 前フレーム深度", depths.size(),
            B::STORAGE | B::COPY_DST);
        let previous_params = buffer(d, "PSC 前フレーム座標系", std::mem::size_of::<Parameters>() as u64,
            B::UNIFORM | B::COPY_DST);
        let output_layout = layout(
            d,
            &[(
                0,
                S::COMPUTE,
                wgpu::BindingType::StorageTexture {
                    access: wgpu::StorageTextureAccess::WriteOnly,
                    format: wgpu::TextureFormat::R32Float,
                    view_dimension: wgpu::TextureViewDimension::D2,
                },
            ), (1, S::COMPUTE, storage(false)),
                (2, S::COMPUTE, storage(true)), (3, S::COMPUTE, uniform())],
        );
        let samples = layout(
            d,
            &[(
                0,
                S::FRAGMENT,
                wgpu::BindingType::Texture {
                    sample_type: wgpu::TextureSampleType::Float { filterable: false },
                    view_dimension: wgpu::TextureViewDimension::D2,
                    multisampled: false,
                },
            )],
        );
        let map = texture(
            d,
            "PolarShadowCache",
            [1024; 2],
            wgpu::TextureFormat::R32Float,
            T::STORAGE_BINDING | T::TEXTURE_BINDING,
            1,
        );
        let view = map.create_view(&Default::default());
        let output_group = group(
            d,
            &output_layout,
            &[wgpu::BindingResource::TextureView(&view), depths.as_entire_binding(),
                previous_depths.as_entire_binding(), previous_params.as_entire_binding()],
        );
        let sample_group = group(d, &samples, &[wgpu::BindingResource::TextureView(&view)]);
        let depth_sample = wgpu::BindingType::Texture {
            sample_type: wgpu::TextureSampleType::Float { filterable: false },
            view_dimension: wgpu::TextureViewDimension::D2,
            multisampled: false,
        };
        let surface_layout = layout(d, &[
            (0, S::FRAGMENT | S::COMPUTE, uniform()),
            (1, S::FRAGMENT | S::COMPUTE, depth_sample),
        ]);
        let surface_group = group(d, &surface_layout, &[
            params.as_entire_binding(),
            wgpu::BindingResource::TextureView(&view),
        ]);
        let subgroup = d.features().contains(wgpu::Features::SUBGROUP);
        let source = SOURCE.replace("//INSERT_SUBGROUP", if subgroup {
            // PSCと同様、Wave全体が同じセルへ投影された場合にAtomicを集約する。
            "let key = subgroupBroadcastFirst(candidate.x);
             if (subgroupAll(candidate.x == key)) {
                 let depth = subgroupMax(candidate.y);
                 if (subgroupElect() && key != 0xffffffffu) {
                     atomicMax(&mainDepths[key], depth);
                 }
                 return;
             }"
        } else { "" });
        let module = shader(d, "PolarShadowCache", &[
            if subgroup { "enable subgroups;" } else { "" }, COMMON, &source]);
        let build_layout = d.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some("PSC 構築"),
            bind_group_layouts: &[&uniforms, &source_layout, &output_layout],
            push_constant_ranges: &[],
        });
        let build = compute(
            d,
            "PSC ソース合成",
            &module,
            "buildCache",
            Some(&build_layout),
        );
        let scatter = compute(d, "PSC メイン深度転写", &module, "scatterMain", Some(&build_layout));
        let reproject_history = compute(d, "PSC 履歴再投影", &module, "reprojectHistory", Some(&build_layout));
        let world = [
            wgpu::CompareFunction::GreaterEqual,
            wgpu::CompareFunction::Always,
        ]
        .map(|compare| {
            pipeline(
                d,
                "PSC ワールド表示",
                &module,
                "worldVertex",
                Some("worldFragment"),
                &[&uniforms, &samples],
                wgpu::TextureFormat::Rgba16Float,
                Some((compare, false)),
                wgpu::PrimitiveTopology::TriangleList,
                None,
            )
        });
        let overlay = pipeline(
            d,
            "PSC 画面表示",
            &module,
            "overlayVertex",
            Some("overlayFragment"),
            &[&uniforms, &samples],
            wgpu::TextureFormat::Rgba8Unorm,
            None,
            wgpu::PrimitiveTopology::TriangleList,
            None,
        );
        Self {
            surface_layout,
            surface_group,
            params,
            uniform_group,
            source_group,
            main_group,
            depths,
            previous_depths,
            previous_params,
            last_params: None,
            scatter,
            output_group,
            sample_group,
            build,
            world,
            overlay,
            reproject_history,
            history_key: None,
            previous_right: Vec3::X,
            size: [1024; 2],
        }
    }

    pub fn resize_cache(&mut self, d: &wgpu::Device, size: [u32; 2]) {
        if self.size == size { return; }
        // 構築・サーフェイス参照・デバッグ表示の全参照先を同時に差し替える。
        let map = texture(d, "PolarShadowCache", size, wgpu::TextureFormat::R32Float,
            T::STORAGE_BINDING | T::TEXTURE_BINDING, 1);
        let view = map.create_view(&Default::default());
        self.depths = buffer(d, "PSC 深度集約", u64::from(size[0]) * u64::from(size[1]) * 4,
            B::STORAGE | B::COPY_DST | B::COPY_SRC);
        self.previous_depths = buffer(d, "PSC 前フレーム深度", self.depths.size(),
            B::STORAGE | B::COPY_DST);
        self.output_group = group(d, &self.build.get_bind_group_layout(2), &[
            wgpu::BindingResource::TextureView(&view), self.depths.as_entire_binding(),
            self.previous_depths.as_entire_binding(), self.previous_params.as_entire_binding()]);
        self.sample_group = group(d, &self.overlay.get_bind_group_layout(1), &[
            wgpu::BindingResource::TextureView(&view)]);
        self.surface_group = group(d, &self.surface_layout, &[
            self.params.as_entire_binding(), wgpu::BindingResource::TextureView(&view)]);
        self.history_key = None;
        self.size = size;
    }

    pub fn rebuild_depth(&mut self, d: &wgpu::Device, depth: &wgpu::Texture) {
        self.main_group = group(d, &self.scatter.get_bind_group_layout(1),
            &[wgpu::BindingResource::TextureView(&depth.create_view(&Default::default()))]);
    }

    pub fn encode(
        &mut self,
        q: &wgpu::Queue,
        e: &mut wgpu::CommandEncoder,
        s: &SceneSettings,
        c: &Camera,
        aspect: f32,
        size: [u32; 2],
        shadows: [[[f32; 4]; 4]; 4],
        scene_active: bool,
        dt: f32,
        timer: &mut GpuProfiler,
    ) {
        let options = &s.polar;
        let light = scene::light(s);
        let fitted = options.mapping == Mapping::ViewFitted;
        let distance = if fitted { options.distance } else { options.outer_radius };
        let inner = if fitted { 0.0 } else { options.effective_inner(s.shadow_distance) / distance };
        let keep_history = options.enabled && scene_active && options.source_main_depth
            && options.preserve_cache && !fitted;
        let mut reuse_history = false;
        if keep_history {
            let key = HistoryKey {
                radii: [inner, distance],
                terrain: (s.seed, s.amplitude, s.mountain_scale),
                trees: (s.trees, s.tree_density),
                pillars: (s.primitives.enabled, s.primitives.side, s.primitives.height, s.primitives.width),
                caster_bias: (options.caster_bias, options.caster_bias_limit,
                    options.caster_bias_constant, options.caster_bias_scale),
            };
            reuse_history = self.history_key.as_ref() == Some(&key);
            self.history_key = Some(key);
        } else {
            self.history_key = None;
        }
        let forward = c.forward();
        let projection = Projection::new(forward, light, s.fov, aspect);
        let right = if !fitted {
            let axis = if light.y.abs() > 0.99 { Vec3::Z } else { Vec3::Y };
            axis.cross(light).normalize()
        } else {
            let projected = forward - light * forward.dot(light);
            if projected.length_squared() > 1e-8 { projected.normalize() } else {
                let previous = self.previous_right - light * self.previous_right.dot(light);
                if previous.length_squared() > 1e-8 { previous.normalize() } else { light.any_orthonormal_vector() }
            }
        };
        if fitted { self.previous_right = right; }
        let up = light.cross(right);
        let span = if fitted { 2.0 * distance / projection.alpha.cos() } else { 32000.0 };
        let parameters = Parameters {
            view_projection: c.matrix(aspect, s.fov).to_cols_array_2d(),
            inverse_view_projection: c.matrix(aspect, s.fov).inverse().to_cols_array_2d(),
            shadows,
            camera: c.position.extend(distance).to_array(),
            right: right.extend(if fitted { 1.0 } else { 0.0 }).to_array(),
            up: up.extend(0.0).to_array(),
            light: light.extend(span).to_array(),
            ellipse: if fitted { [projection.c, projection.a, projection.b, projection.half_angle] }
                else { [0.0, 1.0, 1.0, std::f32::consts::PI] },
            display: [
                options.offset,
                if fitted { projection.extent } else { 1.0 },
                2f32.powf(-s.ev),
                options.receiver_bias,
            ],
            mapping: [inner, options.caster_bias_constant,
                if options.caster_bias { options.caster_bias_limit } else { 0.0 }, options.caster_bias_scale],
            history: [
                0.0, 0.0, 0.0, options.history_push_speed * dt.clamp(0.0, 0.1) / span,
            ],
            flags: [
                u32::from(s.shadows && options.source_csm),
                u32::from(options.projected),
                u32::from(options.grid),
                u32::from(options.enabled && options.apply_shadow && scene_active)
                    | (u32::from(options.pcf) << 1)
                    | (u32::from(options.enabled && options.surface_grid && scene_active) << 2)
                    | (u32::from(keep_history) << 3),
            ],
        };
        q.write_buffer(&self.params, 0, bytemuck::bytes_of(&parameters));
        if !options.enabled || !scene_active {
            return;
        }
        let previous = self.last_params.replace(parameters).filter(|_| reuse_history);
        if let Some(old) = previous {
            q.write_buffer(&self.previous_params, 0, bytemuck::bytes_of(&old));
            e.copy_buffer_to_buffer(&self.depths, 0, &self.previous_depths, 0, self.depths.size());
        }
        e.clear_buffer(&self.depths, 0, None);
        if previous.is_some() {
            // 前フレームの点を現在の座標へ散布してから、現在の深度を重ねる。
            let mut pass = e.begin_compute_pass(&wgpu::ComputePassDescriptor {
                label: Some("PSC 履歴再投影"),
                timestamp_writes: timer.compute_writes("PSC 履歴再投影"),
            });
            pass.set_pipeline(&self.reproject_history);
            pass.set_bind_group(0, &self.uniform_group, &[]);
            pass.set_bind_group(1, &self.main_group, &[]);
            pass.set_bind_group(2, &self.output_group, &[]);
            pass.dispatch_workgroups(self.size[0].div_ceil(8), self.size[1].div_ceil(8), 1);
        }
        if options.source_main_depth {
            let mut pass = e.begin_compute_pass(&wgpu::ComputePassDescriptor {
                label: Some("PSC メイン深度転写"),
                timestamp_writes: timer.compute_writes("PSC メイン深度転写"),
            });
            pass.set_pipeline(&self.scatter);
            pass.set_bind_group(0, &self.uniform_group, &[]);
            pass.set_bind_group(1, &self.main_group, &[]);
            pass.set_bind_group(2, &self.output_group, &[]);
            pass.dispatch_workgroups(size[0].div_ceil(8), size[1].div_ceil(8), 1);
        }
        let mut pass = e.begin_compute_pass(&wgpu::ComputePassDescriptor {
            label: Some("PSC ソース合成"),
            timestamp_writes: timer.compute_writes("PSC ソース合成"),
        });
        pass.set_pipeline(&self.build);
        pass.set_bind_group(0, &self.uniform_group, &[]);
        pass.set_bind_group(1, &self.source_group, &[]);
        pass.set_bind_group(2, &self.output_group, &[]);
        pass.dispatch_workgroups(self.size[0].div_ceil(8), self.size[1].div_ceil(8), 1);

    }

    pub fn draw_world(&self, pass: &mut wgpu::RenderPass<'_>, s: &CacheSettings) {
        if !s.enabled || !s.world_debug {
            return;
        }
        pass.set_pipeline(&self.world[usize::from(s.xray)]);
        pass.set_bind_group(0, &self.uniform_group, &[]);
        pass.set_bind_group(1, &self.sample_group, &[]);
        pass.draw(0..256 * 6, 0..1);
    }

    pub fn draw_overlay(&self, pass: &mut wgpu::RenderPass<'_>, s: &CacheSettings, size: [u32; 2]) {
        if !s.enabled || !s.overlay {
            return;
        }
        let side = ((256.0 * s.scale).round() as u32)
            .min(size[0].saturating_sub(16))
            .min(size[1].saturating_sub(16));
        if side == 0 {
            return;
        }
        pass.set_viewport(
            8.0,
            (size[1] - side - 8) as f32,
            side as f32,
            side as f32,
            0.0,
            1.0,
        );
        pass.set_pipeline(&self.overlay);
        pass.set_bind_group(0, &self.uniform_group, &[]);
        pass.set_bind_group(1, &self.sample_group, &[]);
        pass.draw(0..3, 0..1);
    }
}
