use crate::{
    gpu::*,
    models::{self, Mesh, ModelSettings},
    profiler::GpuProfiler,
    scene::{Camera, Settings},
};
use std::sync::{Arc, Mutex};
use wgpu::{BufferUsages as B, ShaderStages as S};
const COMMON: &str = include_str!("shaders/tile-common.wgsl");
const GEO: &str = include_str!("shaders/foliage-geometry.wgsl");
struct Part {
    vertices: wgpu::Buffer,
    indices: wgpu::Buffer,
    info: wgpu::Buffer,
    count: u32,
    leaf: bool,
}
struct View {
    config: wgpu::Buffer,
    args: wgpu::Buffer,
    compute: wgpu::BindGroup,
    groups: Vec<wgpu::BindGroup>,
}
pub struct Foliage {
    cluster_mode: u32,
    lines: wgpu::RenderPipeline,
    line_groups: Vec<wgpu::BindGroup>,
    line_count: u32,
    line_params: wgpu::Buffer,
    roots: wgpu::Buffer,
    headers: wgpu::Buffer,
    jobs: wgpu::Buffer,
    parts: Vec<Part>,
    views: Vec<View>,
    pipelines: Vec<wgpu::ComputePipeline>,
    z: Vec<wgpu::RenderPipeline>,
    forward: Vec<wgpu::RenderPipeline>,
    bound: [f32; 3],
    socket_count: u32,
    epoch: u32,
    key: (u32, u32),
    pub needs_frame: bool,
    pub stats: String,
    pub visible_counts: [u32; 7],
    focus: [i32; 2],
    readback: wgpu::Buffer,
    mapping: bool,
    copy_pending: bool,
    result: Arc<Mutex<Option<Result<(), wgpu::BufferAsyncError>>>>,
    modeler: bool,
    last_enabled: bool,
}
impl Foliage {
    pub fn new(
        d: &wgpu::Device,
        height: &wgpu::Buffer,
        uniforms: &[&wgpu::Buffer],
        lighting: &wgpu::BindGroupLayout,
        model: Option<&ModelSettings>,
        cluster_mode: u32,
    ) -> Self {
        let base = model.cloned().unwrap_or_else(|| ModelSettings {
            crown: 8.,
            class: 1,
            spread: 1.1,
            depth: 1.1,
            leaf_size: 1.2,
            ..Default::default()
        });
        let clusters = models::clusters(&base);
        let mesh = models::cluster_mesh(&clusters[base.class], base.class, 0);
        let trees: Vec<_> = (0..3)
            .map(|i| {
                let mut p = base.clone();
                if model.is_none() {
                    p.form = [0, 1, 5][i];
                    p.shape = models::preset(p.form);
                    p.variation = i;
                }
                p.seed = base.seed + i as u32 * 1723;
                models::tree(&p, &mesh)
            })
            .collect();
        let lower = trees.iter().map(|t| t.min.y).fold(f32::INFINITY, f32::min);
        let upper = trees
            .iter()
            .map(|t| t.max.y)
            .fold(f32::NEG_INFINITY, f32::max);
        let center = (lower + upper) / 2.;
        let radius = trees
            .iter()
            .map(|t| {
                glam::Vec3::new(
                    t.min.x.abs().max(t.max.x.abs()) + 0.3,
                    (t.min.y - center).abs().max((t.max.y - center).abs()),
                    t.min.z.abs().max(t.max.z.abs()) + 0.3,
                )
                .length()
            })
            .fold(0f32, f32::max)
            + 0.3;
        let leaf_radius = trees
            .iter()
            .flat_map(|t| t.sockets.iter())
            .map(|s| {
                mesh.vertices
                    .chunks_exact(9)
                    .skip(s.ids[0] as usize * mesh.stride)
                    .take(mesh.stride)
                    .map(|v| glam::Vec3::from_slice(v).length())
                    .fold(0f32, f32::max)
                    * s.position[3]
            })
            .fold(0f32, f32::max);
        let socket_count = if cluster_mode > 0 {
            1
        } else {
            base.sockets as u32
        };
        let socket_data = if cluster_mode > 0 {
            vec![
                models::Socket {
                    position: [0., 0., 0., 1.],
                    rotation: [0., 0., 0., 1.],
                    ids: [base.variation as u32, 0, 0, 0]
                };
                3
            ]
        } else {
            trees
                .iter()
                .flat_map(|t| t.sockets.iter().copied())
                .collect::<Vec<_>>()
        };
        let sockets = upload(d, "形状別共有ソケット", &socket_data, B::STORAGE);
        let roots = buffer(d, "樹木根元32B", 10816 * 32, B::STORAGE | B::COPY_DST);
        let headers = buffer(d, "チャンク世界タグ", 169 * 16, B::STORAGE | B::COPY_DST);
        let jobs = buffer(d, "GPU配置要求", 144, B::STORAGE | B::COPY_SRC);
        let cl = layout(
            d,
            &[
                (0, S::COMPUTE, uniform()),
                (1, S::COMPUTE, uniform()),
                (2, S::COMPUTE, storage(false)),
                (3, S::COMPUTE, storage(false)),
                (4, S::COMPUTE, storage(false)),
                (5, S::COMPUTE, storage(false)),
                (6, S::COMPUTE, storage(false)),
                (7, S::COMPUTE, storage(true)),
            ],
        );
        let pl = d.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: None,
            bind_group_layouts: &[&cl],
            push_constant_ranges: &[],
        });
        let module = shader(
            d,
            "Foliage Compute",
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
                include_str!("shaders/foliage-compute.wgsl"),
                if d.features().contains(wgpu::Features::SUBGROUP) {
                    include_str!("shaders/foliage-compact-subgroup.wgsl")
                } else {
                    include_str!("shaders/foliage-compact-workgroup.wgsl")
                },
            ],
        );
        let pipelines = ["schedule", "generate", "cull", "finalize"]
            .map(|name| compute(d, name, &module, name, Some(&pl)))
            .to_vec();
        let gl = layout(
            d,
            &[
                (0, S::VERTEX_FRAGMENT, uniform()),
                (1, S::VERTEX, storage(true)),
                (2, S::VERTEX, storage(true)),
                (3, S::VERTEX, storage(true)),
                (4, S::VERTEX, storage(true)),
                (5, S::VERTEX_FRAGMENT, uniform()),
            ],
        );
        let dm = shader(d, "Foliage ZOnly", &[COMMON, GEO]);
        let shading = crate::sky::shading();
        let fm = shader(
            d,
            "Foliage Forward",
            &[
                COMMON,
                GEO,
                &shading,
                include_str!("shaders/foliage-forward.wgsl"),
                crate::screen_shadow::PARAMS,
                crate::screen_shadow::FORWARD,
            ],
        );
        let z = [false, true]
            .map(|leaf| {
                pipeline(
                    d,
                    "幹/枝葉ZOnly",
                    &dm,
                    "depthMain",
                    None,
                    &[&gl],
                    wgpu::TextureFormat::Rgba16Float,
                    Some((wgpu::CompareFunction::Greater, true)),
                    wgpu::PrimitiveTopology::TriangleList,
                    if leaf { None } else { Some(wgpu::Face::Back) },
                )
            })
            .to_vec();
        let forward = [false, true]
            .map(|leaf| {
                pipeline(
                    d,
                    "幹/枝葉Forward",
                    &fm,
                    "vertexMain",
                    Some("fragmentMain"),
                    &[&gl, lighting],
                    wgpu::TextureFormat::Rgba16Float,
                    Some((wgpu::CompareFunction::Equal, false)),
                    wgpu::PrimitiveTopology::TriangleList,
                    if leaf { None } else { Some(wgpu::Face::Back) },
                )
            })
            .to_vec();
        let meshes: Vec<Mesh> = (0..3)
            .map(|lod| models::wood(&trees, &base, lod))
            .chain((0..4).map(|lod| models::cluster_mesh(&clusters[base.class], base.class, lod)))
            .collect();
        let parts: Vec<_> = meshes
            .into_iter()
            .enumerate()
            .map(|(bucket, m)| Part {
                vertices: upload(d, "形状Storage VB", &m.vertices, B::STORAGE),
                indices: upload(d, "共有IB", &m.indices, B::INDEX),
                info: upload(
                    d,
                    "形状レイアウト",
                    &[
                        m.stride as u32,
                        socket_count,
                        (bucket >= 3) as u32,
                        bucket as u32,
                        0,
                        0,
                        0,
                        0,
                    ],
                    B::UNIFORM | B::COPY_DST,
                ),
                count: m.indices.len() as u32,
                leaf: bucket >= 3,
            })
            .collect();
        let views = uniforms
            .iter()
            .map(|scene| {
                let config = buffer(d, "Foliage条件", 64, B::UNIFORM | B::COPY_DST);
                let items = buffer(d, "可視木ID LOD別", 10816 * 7 * 4, B::STORAGE);
                let args = upload(
                    d,
                    "Foliage Indirect",
                    &parts
                        .iter()
                        .flat_map(|g| [g.count, 0, 0, 0, 0])
                        .collect::<Vec<_>>(),
                    B::STORAGE | B::INDIRECT | B::COPY_DST | B::COPY_SRC,
                );
                let compute = group(
                    d,
                    &cl,
                    &[
                        scene.as_entire_binding(),
                        config.as_entire_binding(),
                        roots.as_entire_binding(),
                        headers.as_entire_binding(),
                        jobs.as_entire_binding(),
                        items.as_entire_binding(),
                        args.as_entire_binding(),
                        height.as_entire_binding(),
                    ],
                );
                let groups = parts
                    .iter()
                    .map(|g| {
                        group(
                            d,
                            &gl,
                            &[
                                scene.as_entire_binding(),
                                roots.as_entire_binding(),
                                items.as_entire_binding(),
                                g.vertices.as_entire_binding(),
                                sockets.as_entire_binding(),
                                g.info.as_entire_binding(),
                            ],
                        )
                    })
                    .collect();
                View {
                    config,
                    args,
                    compute,
                    groups,
                }
            })
            .collect();
        let line_data: Vec<[f32; 4]> = trees
            .iter()
            .flat_map(|t| {
                t.branches.iter().flat_map(|b| {
                    b.windows(2)
                        .flat_map(|p| [p[0].extend(1.).to_array(), p[1].extend(1.).to_array()])
                })
            })
            .collect();
        let line_count = (line_data.len() / 3) as u32;
        let lm = shader(
            d,
            "骨格中心線",
            &[COMMON, include_str!("shaders/skeleton.wgsl")],
        );
        let ll = layout(
            d,
            &[
                (0, S::VERTEX, uniform()),
                (1, S::VERTEX, storage(true)),
                (2, S::VERTEX, storage(true)),
                (3, S::VERTEX_FRAGMENT, uniform()),
            ],
        );
        let lines = pipeline(
            d,
            "骨格中心線",
            &lm,
            "lineVertex",
            Some("lineFragment"),
            &[&ll],
            wgpu::TextureFormat::Rgba16Float,
            Some((wgpu::CompareFunction::GreaterEqual, false)),
            wgpu::PrimitiveTopology::LineList,
            None,
        );
        let data = upload(d, "骨格中心線座標", &line_data, B::STORAGE);
        let params = upload(
            d,
            "骨格頂点数",
            &[line_count, 0, 0, 0],
            B::UNIFORM | B::COPY_DST,
        );
        let line_groups = uniforms
            .iter()
            .map(|scene| {
                group(
                    d,
                    &ll,
                    &[
                        scene.as_entire_binding(),
                        data.as_entire_binding(),
                        roots.as_entire_binding(),
                        params.as_entire_binding(),
                    ],
                )
            })
            .collect();
        Self {
            cluster_mode,
            lines,
            line_groups,
            line_count,
            line_params: params,
            roots,
            headers,
            jobs,
            parts,
            views,
            pipelines,
            z,
            forward,
            bound: [center, radius, leaf_radius / radius],
            socket_count,
            epoch: 1,
            key: (0, 0),
            needs_frame: true,
            stats: "生成待ち".into(),
            visible_counts: [0; 7],
            focus: [i32::MIN; 2],
            readback: buffer(d, "樹木統計", 716, B::MAP_READ | B::COPY_DST),
            mapping: false,
            copy_pending: false,
            result: Arc::new(Mutex::new(None)),
            modeler: model.is_some(),
            last_enabled: true,
        }
    }
    pub fn encode(
        &mut self,
        q: &wgpu::Queue,
        e: &mut wgpu::CommandEncoder,
        s: &Settings,
        c: &Camera,
        size: [u32; 2],
        timer: &mut GpuProfiler,
        preview_count: u32,
        wood_lod: u32,
        statistics: bool,
    ) {
        q.write_buffer(
            &self.line_params,
            4,
            bytemuck::cast_slice(&[2f32.powf(-s.ev)]),
        );
        self.last_enabled = s.trees;
        self.collect();
        let key = (s.seed, s.tree_density.to_bits());
        if self.key != key {
            self.epoch += 1;
            self.key = key;
            self.needs_frame = true;
        }
        let focus = [
            (c.position.x / 64.).floor() as i32,
            (c.position.z / 64.).floor() as i32,
        ];
        if focus != self.focus {
            self.focus = focus;
            self.needs_frame = true;
        }
        for p in &self.parts {
            q.write_buffer(
                &p.info,
                16,
                bytemuck::cast_slice(&[
                    if self.modeler && s.modeler_silhouette {
                        5
                    } else {
                        s.tree_debug
                    },
                    0,
                    0,
                    0,
                ]),
            );
        }
        if s.freeze {
            return;
        }
        if self.modeler {
            // Modelerの配置だけはCPUで用意する。森林の配置・カリングはGPUが所有する。
            let count = if self.cluster_mode == 2 {
                4
            } else if self.cluster_mode == 1 {
                1
            } else {
                preview_count.min(100)
            };
            let mut data = vec![[0f32; 8]; 10816];
            for i in 0..count as usize {
                let n = (count as f32).sqrt().ceil() as usize;
                data[i] = [
                    if self.cluster_mode == 2 {
                        (i as f32 - 1.5) * 4.
                    } else if count == 1 {
                        0.
                    } else {
                        (i % n) as f32 * 12. - (n - 1) as f32 * 6.
                    },
                    0.,
                    if self.cluster_mode > 0 || count == 1 {
                        0.
                    } else {
                        (i / n) as f32 * 12. - (n - 1) as f32 * 6.
                    },
                    1.,
                    0.,
                    (i % 3) as f32,
                    0.,
                    0.,
                ];
            }
            q.write_buffer(&self.roots, 0, bytemuck::cast_slice(&data));
            q.write_buffer(
                &self.headers,
                0,
                bytemuck::cast_slice(&vec![[focus[0], focus[1], self.epoch as i32, 1]; 169]),
            );
            self.needs_frame = false;
        }
        for (i, v) in self.views.iter().enumerate() {
            let mut data = [0u32; 16];
            data[..4].copy_from_slice(&[
                c.position.x.to_bits(),
                c.position.y.to_bits(),
                c.position.z.to_bits(),
                if i == 0 {
                    (size[1] as f32).to_bits()
                } else {
                    1024f32.to_bits()
                },
            ]);
            data[4..8].copy_from_slice(&[s.seed, self.epoch, s.tree_budget, i as u32]);
            data[8..12].copy_from_slice(&[
                if s.trees { s.tree_density } else { 0. }.to_bits(),
                self.bound[0].to_bits(),
                self.bound[1].to_bits(),
                self.bound[2].to_bits(),
            ]);
            data[12..16].copy_from_slice(&[
                self.socket_count,
                (s.leaf_lod + 1) as u32,
                if self.modeler { wood_lod + 1 } else { 0 },
                self.cluster_mode,
            ]);
            q.write_buffer(&v.config, 0, bytemuck::cast_slice(&data));
            for j in 0..7 {
                e.clear_buffer(&v.args, j * 20 + 4, Some(4));
            }
        }
        if s.trees {
            if !self.modeler {
                let mut p = e.begin_compute_pass(&wgpu::ComputePassDescriptor {
                    label: Some("GPU樹木配置"),
                    timestamp_writes: timer.compute_writes("Foliage生成"),
                });
                p.set_bind_group(0, &self.views[0].compute, &[]);
                p.set_pipeline(&self.pipelines[0]);
                p.dispatch_workgroups(1, 1, 1);
                p.set_pipeline(&self.pipelines[1]);
                p.dispatch_workgroups(8, 1, 1);
            }
            let mut p = e.begin_compute_pass(&wgpu::ComputePassDescriptor {
                label: Some("Foliage Cull/LOD"),
                timestamp_writes: timer.compute_writes("Foliage Cull"),
            });
            for v in &self.views {
                p.set_bind_group(0, &v.compute, &[]);
                p.set_pipeline(&self.pipelines[2]);
                p.dispatch_workgroups(169, 1, 1);
                p.set_pipeline(&self.pipelines[3]);
                p.dispatch_workgroups(4, 1, 1);
            }
        }
        if !self.mapping && (statistics || self.needs_frame) {
            e.copy_buffer_to_buffer(&self.jobs, 0, &self.readback, 0, 16);
            for (i, v) in self.views.iter().enumerate() {
                e.copy_buffer_to_buffer(&v.args, 0, &self.readback, 16 + i as u64 * 140, 140);
            }
            self.copy_pending = true;
        }
    }
    pub fn draw(
        &self,
        p: &mut wgpu::RenderPass<'_>,
        view: usize,
        forward: bool,
        lighting: &wgpu::BindGroup,
    ) {
        for (i, g) in self.parts.iter().enumerate() {
            if self.cluster_mode > 0 && !g.leaf {
                continue;
            }
            p.set_pipeline(if forward {
                &self.forward[g.leaf as usize]
            } else {
                &self.z[g.leaf as usize]
            });
            p.set_bind_group(0, &self.views[view].groups[i], &[]);
            if forward {
                p.set_bind_group(1, lighting, &[]);
            }
            p.set_index_buffer(g.indices.slice(..), wgpu::IndexFormat::Uint16);
            p.draw_indexed_indirect(&self.views[view].args, i as u64 * 20);
        }
    }
    pub fn draw_skeleton(&self, p: &mut wgpu::RenderPass<'_>, count: u32) {
        if self.modeler && self.cluster_mode == 0 {
            p.set_pipeline(&self.lines);
            p.set_bind_group(0, &self.line_groups[0], &[]);
            p.draw(0..self.line_count, 0..count);
        }
    }
    pub fn submitted(&mut self, wake: impl Fn() + Send + Sync + 'static) {
        if self.copy_pending {
            self.copy_pending = false;
            self.mapping = true;
            let result = self.result.clone();
            self.readback
                .slice(..)
                .map_async(wgpu::MapMode::Read, move |r| {
                    *result.lock().expect("統計結果") = Some(r);
                    wake();
                });
        }
    }
    #[cfg(not(target_arch = "wasm32"))]
    pub fn pending(&self) -> bool {
        self.mapping
    }
    pub fn collect(&mut self) {
        let result = self.result.lock().expect("統計結果").take();
        if let Some(result) = result {
            if result.is_ok() {
                let data = self.readback.slice(..).get_mapped_range();
                let values: &[u32] = bytemuck::cast_slice(&data);
                self.visible_counts = std::array::from_fn(|i| values[4 + i * 5 + 1]);
                self.needs_frame = self.last_enabled && !self.modeler && values[1] > 0;
                self.stats = format!(
                    "未生成 {}/169 · 幹LOD {} / {} / {}本 · 枝葉LOD {} / {} / {} / {}配置",
                    values[1],
                    values[5],
                    values[10],
                    values[15],
                    values[20],
                    values[25],
                    values[30],
                    values[35]
                );
                let first_part = if self.cluster_mode > 0 { 3 } else { 0 };
                let draws = 7 - first_part;
                let triangles = (first_part..7)
                    .map(|i| values[4 + i * 5 + 1] as u64 * self.parts[i].count as u64 / 3)
                    .sum::<u64>();
                self.stats
                    .push_str(&format!(" · {triangles} Tri / {draws} Indirect Draw・パス"));
                drop(data);
                self.readback.unmap();
            }
            self.mapping = false;
        }
    }
}
