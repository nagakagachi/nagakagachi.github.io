use crate::{
    gpu::*,
    height::Heights,
    profiler::GpuProfiler,
    scene::{self, Camera, Scene, Settings},
    sky::Sky,
};
use wgpu::{BufferUsages as B, ShaderStages as S, TextureUsages as T};
const COMMON: &str = include_str!("shaders/tile-common.wgsl");
const GEOMETRY: &str = include_str!("shaders/terrain-geometry.wgsl");
struct View {
    uniform: wgpu::Buffer,
    args: wgpu::Buffer,
    cull: wgpu::BindGroup,
    geometry: wgpu::BindGroup,
    frozen: Option<Scene>,
}
pub struct Renderer {
    pub foliage: crate::foliage::Foliage,
    pub modeler: bool,
    pub cluster_mode: u32,
    pub skeleton: bool,
    previous_cluster: u32,
    pub preview_count: u32,
    pub wood_lod: u32,
    pub refresh_statistics: bool,
    lighting_layout: wgpu::BindGroupLayout,
    model_key: Option<crate::models::ModelSettings>,
    frozen_camera: Option<Camera>,
    pub output: wgpu::Texture,
    pub size: [u32; 2],
    hdr: wgpu::Texture,
    depth: wgpu::Texture,
    shadow: wgpu::Texture,
    views: Vec<View>,
    heights: Heights,
    sky: Sky,
    camera: wgpu::Buffer,
    lighting: wgpu::Buffer,
    lighting_group: wgpu::BindGroup,
    cull: wgpu::ComputePipeline,
    z: wgpu::RenderPipeline,
    forward: wgpu::RenderPipeline,
    wire: wgpu::RenderPipeline,
    post: wgpu::RenderPipeline,
    post_group: wgpu::BindGroup,
    indices: wgpu::Buffer,
    wire_indices: wgpu::Buffer,
    wire_args: wgpu::Buffer,
    depth_debug: wgpu::RenderPipeline,
    linear_debug: wgpu::RenderPipeline,
    depth_group: wgpu::BindGroup,
    linear_group: wgpu::BindGroup,
    shadow_group: wgpu::BindGroup,
    depth_range: wgpu::Buffer,
    resource_debug: wgpu::RenderPipeline,
    resource_groups: Vec<wgpu::BindGroup>,
    resource_mips: Vec<wgpu::Buffer>,
    pub specular_mip: u32,
    pub samples: u32,
    pub frame: u64,
    previous_exposure: f32,
}
impl Renderer {
    pub fn new(d: &wgpu::Device) -> Self {
        let size = [960, 540];
        let heights = Heights::new(d);
        let camera = buffer(d, "Camera PreExposure", 16, B::UNIFORM | B::COPY_DST);
        let sky = Sky::new(d, &camera);
        let lighting = buffer(d, "Lighting", 464, B::UNIFORM | B::COPY_DST);
        let shadow = texture(
            d,
            "CSM Atlas",
            [2048, 2048],
            wgpu::TextureFormat::Depth32Float,
            T::RENDER_ATTACHMENT | T::TEXTURE_BINDING,
            1,
        );
        let ll = layout(
            d,
            &[
                (0, S::FRAGMENT, uniform()),
                (
                    1,
                    S::FRAGMENT,
                    wgpu::BindingType::Texture {
                        sample_type: wgpu::TextureSampleType::Depth,
                        view_dimension: wgpu::TextureViewDimension::D2,
                        multisampled: false,
                    },
                ),
                (
                    2,
                    S::FRAGMENT,
                    wgpu::BindingType::Sampler(wgpu::SamplerBindingType::Comparison),
                ),
                (3, S::FRAGMENT, uniform()),
                (4, S::FRAGMENT, uniform()),
                (
                    5,
                    S::FRAGMENT,
                    wgpu::BindingType::Texture {
                        sample_type: wgpu::TextureSampleType::Float { filterable: true },
                        view_dimension: wgpu::TextureViewDimension::D2,
                        multisampled: false,
                    },
                ),
                (
                    6,
                    S::FRAGMENT,
                    wgpu::BindingType::Texture {
                        sample_type: wgpu::TextureSampleType::Float { filterable: true },
                        view_dimension: wgpu::TextureViewDimension::D2,
                        multisampled: false,
                    },
                ),
                (
                    7,
                    S::FRAGMENT,
                    wgpu::BindingType::Sampler(wgpu::SamplerBindingType::Filtering),
                ),
            ],
        );
        let shadow_sampler = d.create_sampler(&wgpu::SamplerDescriptor {
            compare: Some(wgpu::CompareFunction::GreaterEqual),
            min_filter: wgpu::FilterMode::Linear,
            mag_filter: wgpu::FilterMode::Linear,
            ..Default::default()
        });
        let lighting_group = group(
            d,
            &ll,
            &[
                lighting.as_entire_binding(),
                wgpu::BindingResource::TextureView(&shadow.create_view(&Default::default())),
                wgpu::BindingResource::Sampler(&shadow_sampler),
                sky.sh.as_entire_binding(),
                camera.as_entire_binding(),
                wgpu::BindingResource::TextureView(&sky.specular.create_view(&Default::default())),
                wgpu::BindingResource::TextureView(&sky.lut.create_view(&Default::default())),
                wgpu::BindingResource::Sampler(&sky.sampler),
            ],
        );
        let gl = layout(
            d,
            &[
                (0, S::VERTEX_FRAGMENT, uniform()),
                (1, S::VERTEX, storage(true)),
                (2, S::VERTEX, storage(true)),
            ],
        );
        let cl = layout(
            d,
            &[
                (0, S::COMPUTE, uniform()),
                (1, S::COMPUTE, storage(false)),
                (2, S::COMPUTE, storage(false)),
            ],
        );
        let cpl = d.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: None,
            bind_group_layouts: &[&cl],
            push_constant_ranges: &[],
        });
        let cm = shader(
            d,
            "Terrain Cull",
            &[
                if d.features().contains(wgpu::Features::SUBGROUP) {
                    if cfg!(target_arch = "wasm32") {
                        "enable subgroups;"
                    } else {
                        ""
                    }
                } else {
                    ""
                },
                COMMON,
                include_str!("shaders/cull.wgsl"),
                if d.features().contains(wgpu::Features::SUBGROUP) {
                    include_str!("shaders/compact-subgroup.wgsl")
                } else {
                    include_str!("shaders/compact-workgroup.wgsl")
                },
            ],
        );
        let cull = compute(d, "Terrain Cull", &cm, "cullMain", Some(&cpl));
        let zmod = shader(
            d,
            "Terrain ZOnly",
            &[COMMON, GEOMETRY, include_str!("shaders/terrain-zonly.wgsl")],
        );
        let shading = crate::sky::shading();
        let fmod = shader(
            d,
            "Terrain Forward",
            &[
                COMMON,
                GEOMETRY,
                &shading,
                include_str!("shaders/terrain-forward.wgsl"),
            ],
        );
        let z = pipeline(
            d,
            "ZOnly Main/CSM",
            &zmod,
            "depthMain",
            None,
            &[&gl],
            wgpu::TextureFormat::Rgba16Float,
            Some((wgpu::CompareFunction::Greater, true)),
            wgpu::PrimitiveTopology::TriangleList,
            Some(wgpu::Face::Back),
        );
        let forward = pipeline(
            d,
            "Forward HDR",
            &fmod,
            "vertexMain",
            Some("fragmentMain"),
            &[&gl, &ll],
            wgpu::TextureFormat::Rgba16Float,
            Some((wgpu::CompareFunction::Equal, false)),
            wgpu::PrimitiveTopology::TriangleList,
            Some(wgpu::Face::Back),
        );
        let wire = pipeline(
            d,
            "Wire",
            &fmod,
            "wireVertexMain",
            Some("wireMain"),
            &[&gl, &ll],
            wgpu::TextureFormat::Rgba16Float,
            Some((wgpu::CompareFunction::GreaterEqual, false)),
            wgpu::PrimitiveTopology::LineList,
            None,
        );
        let (ib, lines) = scene::indices();
        let indices = upload(d, "タイル共有IB", &ib, B::INDEX);
        let wire_indices = upload(d, "Wire IB", &lines, B::INDEX);
        let index_count = ib.len() as u32;
        let wire_count = lines.len() as u32;
        let views: Vec<View> = (0..5)
            .map(|_| {
                let uniform = buffer(d, "Scene", 752, B::UNIFORM | B::COPY_DST);
                let visible = buffer(d, "可視タイルID", 1600 * 4, B::STORAGE);
                let args = upload(
                    d,
                    "Indirect",
                    &[index_count, 0u32, 0, 0, 0],
                    B::STORAGE | B::INDIRECT | B::COPY_DST | B::COPY_SRC,
                );
                let cull = group(
                    d,
                    &cl,
                    &[
                        uniform.as_entire_binding(),
                        visible.as_entire_binding(),
                        args.as_entire_binding(),
                    ],
                );
                let geometry = group(
                    d,
                    &gl,
                    &[
                        uniform.as_entire_binding(),
                        heights.data.as_entire_binding(),
                        visible.as_entire_binding(),
                    ],
                );
                View {
                    uniform,
                    args,
                    cull,
                    geometry,
                    frozen: None,
                }
            })
            .collect();
        let wire_args = upload(
            d,
            "Wire Indirect",
            &[wire_count, 0u32, 0, 0, 0],
            B::INDIRECT | B::COPY_DST,
        );
        let (hdr, depth, output) = targets(d, size);
        let pm = shader(
            d,
            "ACES Tonemapping",
            &[include_str!("shaders/post-process.wgsl")],
        );
        let pl = layout(
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
        let post = pipeline(
            d,
            "PostProcess",
            &pm,
            "postVertex",
            Some("postFragment"),
            &[&pl],
            wgpu::TextureFormat::Rgba8Unorm,
            None,
            wgpu::PrimitiveTopology::TriangleList,
            None,
        );
        let post_group = group(
            d,
            &pl,
            &[wgpu::BindingResource::TextureView(
                &hdr.create_view(&Default::default()),
            )],
        );
        let dm = shader(
            d,
            "Depth Debug",
            &[include_str!("shaders/depth-debug.wgsl")],
        );
        let dep = wgpu::BindingType::Texture {
            sample_type: wgpu::TextureSampleType::Depth,
            view_dimension: wgpu::TextureViewDimension::D2,
            multisampled: false,
        };
        let dl = layout(d, &[(0, S::FRAGMENT, dep)]);
        let lin = layout(d, &[(0, S::FRAGMENT, dep), (1, S::FRAGMENT, uniform())]);
        let depth_debug = pipeline(
            d,
            "RawDepth",
            &dm,
            "depthDebugVertex",
            Some("depthDebugFragment"),
            &[&dl],
            wgpu::TextureFormat::Rgba8Unorm,
            None,
            wgpu::PrimitiveTopology::TriangleList,
            None,
        );
        let linear_debug = pipeline(
            d,
            "LinearDepth",
            &dm,
            "depthDebugVertex",
            Some("linearDepthFragment"),
            &[&lin],
            wgpu::TextureFormat::Rgba8Unorm,
            None,
            wgpu::PrimitiveTopology::TriangleList,
            None,
        );
        let depth_range = buffer(d, "LinearDepth範囲", 16, B::UNIFORM | B::COPY_DST);
        let depth_group = group(
            d,
            &dl,
            &[wgpu::BindingResource::TextureView(
                &depth.create_view(&Default::default()),
            )],
        );
        let linear_group = group(
            d,
            &lin,
            &[
                wgpu::BindingResource::TextureView(&depth.create_view(&Default::default())),
                depth_range.as_entire_binding(),
            ],
        );
        let shadow_group = group(
            d,
            &dl,
            &[wgpu::BindingResource::TextureView(
                &shadow.create_view(&Default::default()),
            )],
        );
        let rm = shader(
            d,
            "環境マップ表示",
            &[include_str!("shaders/resource-debug.wgsl")],
        );
        let rl = layout(
            d,
            &[
                (
                    0,
                    S::FRAGMENT,
                    wgpu::BindingType::Texture {
                        sample_type: wgpu::TextureSampleType::Float { filterable: false },
                        view_dimension: wgpu::TextureViewDimension::D2,
                        multisampled: false,
                    },
                ),
                (1, S::FRAGMENT, uniform()),
                (2, S::FRAGMENT, uniform()),
            ],
        );
        let resource_debug = pipeline(
            d,
            "環境マップ表示",
            &rm,
            "vs",
            Some("fs"),
            &[&rl],
            wgpu::TextureFormat::Rgba8Unorm,
            None,
            wgpu::PrimitiveTopology::TriangleList,
            None,
        );
        let resource_mips = (0..2)
            .map(|_| buffer(d, "表示Mip・領域", 16, B::UNIFORM | B::COPY_DST))
            .collect::<Vec<_>>();
        let resource_groups = [&sky.map, &sky.specular]
            .iter()
            .enumerate()
            .map(|(i, t)| {
                group(
                    d,
                    &rl,
                    &[
                        wgpu::BindingResource::TextureView(&t.create_view(&Default::default())),
                        camera.as_entire_binding(),
                        resource_mips[i].as_entire_binding(),
                    ],
                )
            })
            .collect();
        let foliage = crate::foliage::Foliage::new(
            d,
            &heights.data,
            &views.iter().map(|v| &v.uniform).collect::<Vec<_>>(),
            &ll,
            None,
            0,
        );
        Self {
            resource_debug,
            resource_groups,
            resource_mips,
            specular_mip: 0,
            foliage,
            modeler: false,
            cluster_mode: 0,
            skeleton: true,
            previous_cluster: 0,
            preview_count: 1,
            wood_lod: 0,
            refresh_statistics: true,
            lighting_layout: ll,
            model_key: None,
            frozen_camera: None,
            output,
            size,
            hdr,
            depth,
            shadow,
            views,
            heights,
            sky,
            camera,
            lighting,
            lighting_group,
            cull,
            z,
            forward,
            wire,
            post,
            post_group,
            indices,
            wire_indices,
            wire_args,
            depth_debug,
            linear_debug,
            depth_group,
            linear_group,
            shadow_group,
            depth_range,
            samples: 0,
            frame: 0,
            previous_exposure: 1.,
        }
    }
    pub fn configure_model(
        &mut self,
        d: &wgpu::Device,
        model: Option<&crate::models::ModelSettings>,
    ) {
        if self.previous_cluster != self.cluster_mode
            || self.modeler != model.is_some()
            || model.is_some_and(|p| self.model_key.as_ref() != Some(p))
        {
            self.foliage = crate::foliage::Foliage::new(
                d,
                &self.heights.data,
                &self.views.iter().map(|v| &v.uniform).collect::<Vec<_>>(),
                &self.lighting_layout,
                model,
                self.cluster_mode,
            );
            self.previous_cluster = self.cluster_mode;
            self.modeler = model.is_some();
            self.model_key = model.cloned();
        }
    }
    pub fn resize(&mut self, d: &wgpu::Device, size: [u32; 2]) -> bool {
        let size = [size[0].clamp(1, 4096), size[1].clamp(1, 4096)];
        if size == self.size {
            return false;
        }
        self.size = size;
        let (hdr, depth, out) = targets(d, size);
        self.hdr = hdr;
        self.depth = depth;
        self.output = out;
        self.post_group = group(
            d,
            &self.post.get_bind_group_layout(0),
            &[wgpu::BindingResource::TextureView(
                &self.hdr.create_view(&Default::default()),
            )],
        );
        self.depth_group = group(
            d,
            &self.depth_debug.get_bind_group_layout(0),
            &[wgpu::BindingResource::TextureView(
                &self.depth.create_view(&Default::default()),
            )],
        );
        self.linear_group = group(
            d,
            &self.linear_debug.get_bind_group_layout(0),
            &[
                wgpu::BindingResource::TextureView(&self.depth.create_view(&Default::default())),
                self.depth_range.as_entire_binding(),
            ],
        );
        true
    }
    pub fn encode(
        &mut self,
        q: &wgpu::Queue,
        e: &mut wgpu::CommandEncoder,
        s: &Settings,
        c: &Camera,
        timer: &mut GpuProfiler,
    ) {
        self.frame += 1;
        let aspect = self.size[0] as f32 / self.size[1] as f32;
        let matrix = c.matrix(aspect, s.fov);
        if !s.freeze || self.frozen_camera.is_none() {
            self.frozen_camera = Some(c.clone());
        }
        let basis = self.frozen_camera.as_ref().expect("フレーム視点");
        let cascades = scene::cascades(s, basis, aspect);
        let exposure = 2f32.powf(-s.ev);
        let camera_frame = scene::CameraUniform {
            pre_exposure: exposure,
            inverse: 1. / exposure,
            previous: self.previous_exposure,
            history_to_current: exposure / self.previous_exposure,
        };
        q.write_buffer(&self.camera, 0, bytemuck::bytes_of(&camera_frame));
        self.previous_exposure = exposure;
        // 最初のマーカーからUI末尾までを計測する。CPU転送・Present待ちは含めない。
        {
            let _marker = e.begin_compute_pass(&wgpu::ComputePassDescriptor {
                label: Some("GPU Frame開始"),
                timestamp_writes: timer.compute_writes("Frame開始"),
            });
        }
        self.sky.encode(q, e, s, c, aspect);
        if !self.modeler && (!s.freeze || self.views[0].frozen.is_none()) {
            self.samples = self.heights.encode(q, e, s, c.position.x, c.position.z);
        }
        for (i, v) in self.views.iter_mut().enumerate() {
            let projection = if i == 0 {
                matrix
            } else {
                cascades[i - 1].matrix
            };
            let mut data = scene::scene(s, basis, projection, self.heights.windows);
            if i > 0 {
                let p = &cascades[i - 1].caster;
                for (j, plane) in p.iter().enumerate() {
                    data.caster_planes[j] = *plane;
                }
                data.caster_info = [p.len() as u32, s.caster_volume as u32, 0, 0];
            }
            if s.freeze {
                if let Some(old) = v.frozen {
                    data = old;
                    data.matrix = projection.to_cols_array_2d();
                }
            } else {
                v.frozen = Some(data);
            }
            q.write_buffer(&v.uniform, 0, bytemuck::bytes_of(&data));
        }
        let l = scene::light(s);
        let values = scene::Lighting {
            shadow_view_projection: cascades[0].matrix.to_cols_array_2d(),
            light: l.extend(if s.direct { 20. } else { 0. }).to_array(),
            shadow: [
                s.shadows as u32 as f32,
                s.depth_bias,
                s.normal_bias,
                1. / 2048.,
            ],
            filter: [
                s.pcf as f32,
                s.shadow_mask as u32 as f32,
                if s.csm_grid { s.grid_texels } else { 0. },
                0.,
            ],
            sky_diffuse: [s.albedo[0], s.albedo[1], s.albedo[2], s.sky],
            camera_position: c.position.extend(0.).to_array(),
            atmosphere: [
                s.aerial as u32 as f32,
                2000.,
                s.constant_albedo as u32 as f32,
                0.,
            ],
            shadow_matrices: std::array::from_fn(|i| cascades[i].matrix.to_cols_array_2d()),
            splits: std::array::from_fn(|i| cascades[i].split),
            view_forward: basis
                .forward()
                .extend(-basis.forward().dot(basis.position))
                .to_array(),
            material: [
                s.roughness,
                s.metallic,
                s.specular as u32 as f32,
                s.csm_colors as u32 as f32,
            ],
        };
        q.write_buffer(&self.lighting, 0, bytemuck::bytes_of(&values));
        if !self.modeler && (!s.freeze || self.frame == 1) {
            for v in &self.views {
                e.clear_buffer(&v.args, 4, Some(4));
            }
            {
                let mut p = e.begin_compute_pass(&wgpu::ComputePassDescriptor {
                    label: Some("GPU Culling"),
                    timestamp_writes: timer.compute_writes("Terrain Cull"),
                });
                p.set_pipeline(&self.cull);
                for v in &self.views {
                    p.set_bind_group(0, &v.cull, &[]);
                    p.dispatch_workgroups(scene::layout(s).1.div_ceil(64), 1, 1);
                }
            }
            e.copy_buffer_to_buffer(&self.views[0].args, 4, &self.wire_args, 4, 4);
        }
        self.foliage.encode(
            q,
            e,
            s,
            c,
            self.size,
            timer,
            self.preview_count,
            self.wood_lod,
            self.refresh_statistics,
        );
        let depth = self.depth.create_view(&Default::default());
        let hdr = self.hdr.create_view(&Default::default());
        let shadow = self.shadow.create_view(&Default::default());
        {
            let mut p = e.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: Some("ZPrePass"),
                color_attachments: &[],
                depth_stencil_attachment: Some(wgpu::RenderPassDepthStencilAttachment {
                    view: &depth,
                    depth_ops: Some(wgpu::Operations {
                        load: wgpu::LoadOp::Clear(0.),
                        store: wgpu::StoreOp::Store,
                    }),
                    stencil_ops: None,
                }),
                timestamp_writes: timer.render_writes("ZPrePass"),
                occlusion_query_set: None,
            });
            p.set_pipeline(&self.z);
            p.set_bind_group(0, &self.views[0].geometry, &[]);
            p.set_index_buffer(self.indices.slice(..), wgpu::IndexFormat::Uint16);
            if !self.modeler {
                p.draw_indexed_indirect(&self.views[0].args, 0);
            }
            self.foliage.draw(&mut p, 0, false, &self.lighting_group);
        }
        {
            let mut p = e.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: Some("ShadowPass"),
                color_attachments: &[],
                depth_stencil_attachment: Some(wgpu::RenderPassDepthStencilAttachment {
                    view: &shadow,
                    depth_ops: Some(wgpu::Operations {
                        load: wgpu::LoadOp::Clear(0.),
                        store: wgpu::StoreOp::Store,
                    }),
                    stencil_ops: None,
                }),
                timestamp_writes: timer.render_writes("CSM"),
                occlusion_query_set: None,
            });
            if s.shadows {
                p.set_pipeline(&self.z);
                p.set_index_buffer(self.indices.slice(..), wgpu::IndexFormat::Uint16);
                for i in 0..4 {
                    p.set_pipeline(&self.z);
                    p.set_index_buffer(self.indices.slice(..), wgpu::IndexFormat::Uint16);
                    p.set_viewport(
                        (i % 2) as f32 * 1024.,
                        (i / 2) as f32 * 1024.,
                        1024.,
                        1024.,
                        0.,
                        1.,
                    );
                    p.set_scissor_rect((i % 2) as u32 * 1024, (i / 2) as u32 * 1024, 1024, 1024);
                    p.set_bind_group(0, &self.views[i + 1].geometry, &[]);
                    if !self.modeler {
                        p.draw_indexed_indirect(&self.views[i + 1].args, 0);
                    }
                    self.foliage
                        .draw(&mut p, i + 1, false, &self.lighting_group);
                }
            }
        }
        {
            let mut p = e.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: Some("ForwardShadingPass HDR"),
                color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                    view: &hdr,
                    depth_slice: None,
                    resolve_target: None,
                    ops: wgpu::Operations {
                        load: wgpu::LoadOp::Clear(wgpu::Color::BLACK),
                        store: wgpu::StoreOp::Store,
                    },
                })],
                depth_stencil_attachment: Some(wgpu::RenderPassDepthStencilAttachment {
                    view: &depth,
                    depth_ops: None,
                    stencil_ops: None,
                }),
                timestamp_writes: timer.render_writes("Forward + Sky"),
                occlusion_query_set: None,
            });
            p.set_pipeline(&self.forward);
            p.set_bind_group(0, &self.views[0].geometry, &[]);
            p.set_bind_group(1, &self.lighting_group, &[]);
            p.set_index_buffer(self.indices.slice(..), wgpu::IndexFormat::Uint16);
            if !self.modeler {
                p.draw_indexed_indirect(&self.views[0].args, 0);
            }
            self.foliage.draw(&mut p, 0, true, &self.lighting_group);
            if self.skeleton && self.modeler {
                self.foliage.draw_skeleton(&mut p, self.preview_count);
            }
            p.set_pipeline(&self.sky.render);
            p.set_bind_group(0, &self.sky.render_group, &[]);
            p.draw(0..3, 0..1);
            if s.wire && !self.modeler {
                p.set_pipeline(&self.wire);
                p.set_bind_group(0, &self.views[0].geometry, &[]);
                p.set_bind_group(1, &self.lighting_group, &[]);
                p.set_index_buffer(self.wire_indices.slice(..), wgpu::IndexFormat::Uint16);
                p.draw_indexed_indirect(&self.wire_args, 0);
            }
        }
        q.write_buffer(
            &self.depth_range,
            0,
            bytemuck::cast_slice(&[1., s.linear_distance, 0., 0.]),
        );
        let output = self.output.create_view(&Default::default());
        let mut p = e.begin_render_pass(&wgpu::RenderPassDescriptor {
            label: Some("PostProcess"),
            color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                view: &output,
                depth_slice: None,
                resolve_target: None,
                ops: wgpu::Operations {
                    load: wgpu::LoadOp::Clear(wgpu::Color::BLACK),
                    store: wgpu::StoreOp::Store,
                },
            })],
            depth_stencil_attachment: None,
            timestamp_writes: timer.render_writes("PostProcess"),
            occlusion_query_set: None,
        });
        match s.debug {
            1 => {
                p.set_pipeline(&self.depth_debug);
                p.set_bind_group(0, &self.depth_group, &[]);
            }
            2 => {
                p.set_pipeline(&self.linear_debug);
                p.set_bind_group(0, &self.linear_group, &[]);
            }
            _ => {
                p.set_pipeline(&self.post);
                p.set_bind_group(0, &self.post_group, &[]);
            }
        }
        p.draw(0..3, 0..1);
        let mut offset = 8u32;
        for (i, enabled) in [s.sky_debug, s.specular_debug].iter().enumerate() {
            if *enabled {
                let side = 192u32
                    .min(self.size[1].saturating_sub(16))
                    .min(self.size[0].saturating_sub(offset + 8));
                if side > 0 {
                    q.write_buffer(
                        &self.resource_mips[i],
                        0,
                        bytemuck::cast_slice(&[
                            if i == 0 { 0 } else { self.specular_mip },
                            offset,
                            8,
                            side,
                        ]),
                    );
                    p.set_viewport(offset as f32, 8., side as f32, side as f32, 0., 1.);
                    p.set_pipeline(&self.resource_debug);
                    p.set_bind_group(0, &self.resource_groups[i], &[]);
                    p.draw(0..3, 0..1);
                    offset += side + 8;
                }
            }
        }
        if s.shadow_debug {
            p.set_viewport(
                8.,
                8.,
                256f32.min(self.size[0] as f32),
                256f32.min(self.size[1] as f32),
                0.,
                1.,
            );
            p.set_pipeline(&self.depth_debug);
            p.set_bind_group(0, &self.shadow_group, &[]);
            p.draw(0..3, 0..1);
        }
    }
}
fn targets(d: &wgpu::Device, size: [u32; 2]) -> (wgpu::Texture, wgpu::Texture, wgpu::Texture) {
    let usage = T::RENDER_ATTACHMENT | T::TEXTURE_BINDING;
    (
        texture(
            d,
            "Scene HDR Linear",
            size,
            wgpu::TextureFormat::Rgba16Float,
            usage,
            1,
        ),
        texture(
            d,
            "Infinite Reversed Z",
            size,
            wgpu::TextureFormat::Depth32Float,
            usage,
            1,
        ),
        texture(
            d,
            "Display sRGB encoded",
            size,
            wgpu::TextureFormat::Rgba8Unorm,
            usage | T::COPY_SRC,
            1,
        ),
    )
}
