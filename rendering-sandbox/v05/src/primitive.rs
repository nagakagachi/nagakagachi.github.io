use crate::{gpu::*, profiler::GpuProfiler, scene::Settings};
use bytemuck::{Pod, Zeroable};
use glam::Vec3;
use wgpu::{BufferUsages as B, ShaderStages as S};
const COMMON: &str = include_str!("shaders/tile-common.wgsl");
const TYPES: &str = include_str!("shaders/primitive-types.wgsl");
const GEOMETRY: &str = include_str!("shaders/primitive-geometry.wgsl");
const CAPACITY: u64 = 64;

#[derive(Clone, PartialEq)]
pub struct PrimitiveSettings {
    pub enabled: bool,
    pub side: f32,
    pub height: f32,
    pub width: f32,
    pub albedo: [f32; 3],
    pub roughness: f32,
    pub metallic: f32,
}
impl Default for PrimitiveSettings {
    fn default() -> Self {
        Self {
            enabled: true,
            side: 16000.0,
            height: 3000.0,
            width: 400.0,
            albedo: [0.5; 3],
            roughness: 0.8,
            metallic: 0.0,
        }
    }
}
#[repr(C)]
#[derive(Clone, Copy, Pod, Zeroable)]
pub struct Vertex {
    pub position: [f32; 4],
    pub normal: [f32; 4],
}
#[repr(C)]
#[derive(Clone, Copy, PartialEq, Pod, Zeroable)]
pub struct Instance {
    pub position: [f32; 4],
    pub scale: [f32; 4],
    pub rotation: [f32; 4],
    pub albedo: [f32; 4],
}
// 描画側は汎用のメッシュとインスタンスを受け取る。柱配置は別のシーン生成処理。
// メッシュは原点中心の[-0.5,0.5]内に正規化する。位置は底面中心、Scaleはワールド寸法。
// この規約により、箱以外のPrimitiveでも同じ変換・回転AABBカリングを使える。
pub struct Mesh {
    pub vertices: Vec<Vertex>,
    pub indices: Vec<u16>,
}
impl Mesh {
    pub fn cuboid() -> Self {
        let mut vertices = Vec::new();
        let mut indices = Vec::new();
        for normal in [Vec3::X, -Vec3::X, Vec3::Y, -Vec3::Y, Vec3::Z, -Vec3::Z] {
            let axis = if normal.y.abs() > 0.9 {
                Vec3::Z
            } else {
                Vec3::Y
            };
            let t = axis.cross(normal).normalize();
            let b = normal.cross(t);
            let base = vertices.len() as u16;
            for (x, y) in [(-1.0, -1.0), (1.0, -1.0), (1.0, 1.0), (-1.0, 1.0)] {
                vertices.push(Vertex {
                    position: ((normal + t * x + b * y) * 0.5).extend(1.0).to_array(),
                    normal: normal.extend(0.0).to_array(),
                });
            }
            indices.extend([base, base + 1, base + 2, base, base + 2, base + 3]);
        }
        Self { vertices, indices }
    }
}
pub fn pillars(s: &PrimitiveSettings) -> [Instance; 4] {
    let r = s.side * 0.5;
    [(r, 0.0), (-r, 0.0), (0.0, r), (0.0, -r)].map(|(x, z)| Instance {
        // 地形の粗いLODとの小さな差を隠すため、根元を100m埋める。
        position: [x, -100.0, z, 1.0],
        scale: [s.width, s.height + 100.0, s.width, s.metallic],
        rotation: [0.0, 0.0, 0.0, 1.0],
        albedo: [s.albedo[0], s.albedo[1], s.albedo[2], s.roughness],
    })
}
struct View {
    compute: wgpu::BindGroup,
    draw: wgpu::BindGroup,
    args: wgpu::Buffer,
}
pub struct Primitives {
    requests: wgpu::Buffer,
    config: wgpu::Buffer,
    indices: wgpu::Buffer,
    index_count: u32,
    views: Vec<View>,
    place: wgpu::ComputePipeline,
    cull: wgpu::ComputePipeline,
    depth: wgpu::RenderPipeline,
    forward: wgpu::RenderPipeline,
    key: Option<(u32, u32, u32, bool)>,
    previous: Vec<Instance>,
    instance_count: u32,
    enabled: bool,
}
impl Primitives {
    pub fn new(
        d: &wgpu::Device,
        scenes: &[&wgpu::Buffer],
        lighting: &wgpu::BindGroupLayout,
        polar: &wgpu::BindGroupLayout,
        mesh: Mesh,
    ) -> Self {
        let vertices = upload(d, "Primitive StorageVB", &mesh.vertices, B::STORAGE);
        let indices = upload(d, "Primitive IB", &mesh.indices, B::INDEX);
        let instances = buffer(d, "Primitive インスタンス", CAPACITY * 64, B::STORAGE);
        let requests = buffer(
            d,
            "Primitive 配置要求",
            CAPACITY * 64,
            B::STORAGE | B::COPY_DST,
        );
        let config = buffer(d, "Primitive 設定", 32, B::UNIFORM | B::COPY_DST);
        let cl = layout(
            d,
            &[
                (0, S::COMPUTE, uniform()),
                (1, S::COMPUTE, uniform()),
                (2, S::COMPUTE, storage(true)),
                (3, S::COMPUTE, storage(false)),
                (4, S::COMPUTE, storage(false)),
                (5, S::COMPUTE, storage(false)),
            ],
        );
        let pl = d.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some("Primitive 配置・カリング"),
            bind_group_layouts: &[&cl],
            push_constant_ranges: &[],
        });
        let cm = shader(
            d,
            "Primitive Compute",
            &[
                COMMON,
                TYPES,
                include_str!("shaders/terrain-height-function.wgsl"),
                include_str!("shaders/primitive-compute.wgsl"),
            ],
        );
        let place = compute(d, "Primitive 配置", &cm, "placePrimitives", Some(&pl));
        let cull = compute(d, "Primitive カリング", &cm, "cullPrimitives", Some(&pl));
        let gl = layout(
            d,
            &[
                (0, S::VERTEX_FRAGMENT, uniform()),
                (1, S::VERTEX, storage(true)),
                (2, S::VERTEX, storage(true)),
                (3, S::VERTEX, storage(true)),
            ],
        );
        let zmod = shader(d, "Primitive ZOnly", &[COMMON, TYPES, GEOMETRY]);
        let shading = crate::sky::shading();
        let fm = shader(
            d,
            "Primitive Forward",
            &[
                COMMON,
                TYPES,
                GEOMETRY,
                &shading,
                include_str!("shaders/surface-shading.wgsl"),
                include_str!("shaders/polar-shadow-sampling.wgsl"),
                include_str!("shaders/polar-shadow-common.wgsl"),
                include_str!("shaders/primitive-forward.wgsl"),
            ],
        );
        let depth = pipeline(
            d,
            "Primitive ZOnly Main/CSM",
            &zmod,
            "primitiveDepth",
            None,
            &[&gl],
            wgpu::TextureFormat::Rgba16Float,
            Some((wgpu::CompareFunction::Greater, true)),
            wgpu::PrimitiveTopology::TriangleList,
            Some(wgpu::Face::Back),
        );
        let forward = pipeline(
            d,
            "Primitive Forward HDR",
            &fm,
            "primitiveVertex",
            Some("primitiveFragment"),
            &[&gl, lighting, polar],
            wgpu::TextureFormat::Rgba16Float,
            Some((wgpu::CompareFunction::Equal, false)),
            wgpu::PrimitiveTopology::TriangleList,
            Some(wgpu::Face::Back),
        );
        let views = scenes
            .iter()
            .map(|scene| {
                let visible = buffer(d, "Primitive 可視ID", CAPACITY * 4, B::STORAGE);
                let args = buffer(d, "Primitive Indirect", 20, B::STORAGE | B::INDIRECT);
                let compute = group(
                    d,
                    &cl,
                    &[
                        scene.as_entire_binding(),
                        config.as_entire_binding(),
                        requests.as_entire_binding(),
                        instances.as_entire_binding(),
                        visible.as_entire_binding(),
                        args.as_entire_binding(),
                    ],
                );
                let draw = group(
                    d,
                    &gl,
                    &[
                        scene.as_entire_binding(),
                        vertices.as_entire_binding(),
                        instances.as_entire_binding(),
                        visible.as_entire_binding(),
                    ],
                );
                View {
                    compute,
                    draw,
                    args,
                }
            })
            .collect();
        Self {
            requests,
            config,
            indices,
            index_count: mesh.indices.len() as u32,
            views,
            place,
            cull,
            depth,
            forward,
            key: None,
            previous: Vec::new(),
            instance_count: 0,
            enabled: false,
        }
    }
    pub fn encode(
        &mut self,
        q: &wgpu::Queue,
        e: &mut wgpu::CommandEncoder,
        s: &Settings,
        requests: &[Instance],
        modeler: bool,
        timer: &mut GpuProfiler,
    ) {
        self.enabled = s.primitives.enabled && !modeler;
        let key = (
            s.seed,
            s.amplitude.to_bits(),
            s.mountain_scale.to_bits(),
            self.enabled,
        );
        let dirty = self.key.as_ref() != Some(&key) || self.previous.as_slice() != requests;
        if dirty {
            assert!(requests.len() as u64 <= CAPACITY);
            q.write_buffer(&self.requests, 0, bytemuck::cast_slice(requests));
            q.write_buffer(
                &self.config,
                0,
                bytemuck::cast_slice(&[
                    s.amplitude.to_bits(),
                    s.mountain_scale.to_bits(),
                    0,
                    0,
                    if self.enabled {
                        requests.len() as u32
                    } else {
                        0
                    },
                    s.seed,
                    self.index_count,
                    0,
                ]),
            );
            self.instance_count = requests.len() as u32;
            self.previous.clear();
            self.previous.extend_from_slice(requests);
            self.key = Some(key);
        }
        if !self.enabled {
            return;
        }
        let mut pass = e.begin_compute_pass(&wgpu::ComputePassDescriptor {
            label: Some("Primitive 配置・カリング"),
            timestamp_writes: timer.compute_writes("Primitive 配置・カリング"),
        });
        if dirty {
            pass.set_pipeline(&self.place);
            pass.set_bind_group(0, &self.views[0].compute, &[]);
            pass.dispatch_workgroups(self.instance_count.div_ceil(4), 1, 1);
        }
        pass.set_pipeline(&self.cull);
        for view in &self.views {
            pass.set_bind_group(0, &view.compute, &[]);
            pass.dispatch_workgroups(1, 1, 1);
        }
    }
    pub fn draw(
        &self,
        p: &mut wgpu::RenderPass<'_>,
        view: usize,
        forward: bool,
        lighting: &wgpu::BindGroup,
        polar: &wgpu::BindGroup,
    ) {
        if !self.enabled {
            return;
        }
        p.set_pipeline(if forward { &self.forward } else { &self.depth });
        p.set_bind_group(0, &self.views[view].draw, &[]);
        if forward {
            p.set_bind_group(1, lighting, &[]);
            p.set_bind_group(2, polar, &[]);
        }
        p.set_index_buffer(self.indices.slice(..), wgpu::IndexFormat::Uint16);
        p.draw_indexed_indirect(&self.views[view].args, 0);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn cuboid_triangles_face_outward() {
        let mesh = Mesh::cuboid();
        assert_eq!(mesh.indices.len(), 36);
        for triangle in mesh.indices.chunks_exact(3) {
            let v: Vec<_> = triangle
                .iter()
                .map(|i| Vec3::from_slice(&mesh.vertices[*i as usize].position))
                .collect();
            let normal = (v[1] - v[0]).cross(v[2] - v[0]);
            assert!(normal.dot(v[0]) > 0.0);
        }
        let items = pillars(&PrimitiveSettings::default());
        assert_eq!(items.len(), 4);
        assert_eq!(items[0].position[0], 8000.0);
        assert_eq!(std::mem::size_of::<Instance>(), 64);
    }
    #[test]
    fn primitive_and_shared_shaders_validate() {
        let shading = crate::sky::shading();
        let variants = [
            vec![
                COMMON,
                TYPES,
                include_str!("shaders/terrain-height-function.wgsl"),
                include_str!("shaders/primitive-compute.wgsl"),
            ],
            vec![
                COMMON,
                TYPES,
                GEOMETRY,
                &shading,
                include_str!("shaders/surface-shading.wgsl"),
                include_str!("shaders/polar-shadow-sampling.wgsl"),
                include_str!("shaders/polar-shadow-common.wgsl"),
                include_str!("shaders/primitive-forward.wgsl"),
            ],
            vec![
                include_str!("shaders/terrain-height-function.wgsl"),
                include_str!("shaders/generate-height.wgsl"),
            ],
        ];
        for source in variants {
            let module =
                naga::front::wgsl::parse_str(&source.join("\n")).expect("Primitive/共通WGSL構文");
            naga::valid::Validator::new(
                naga::valid::ValidationFlags::all(),
                naga::valid::Capabilities::all(),
            )
            .validate(&module)
            .expect("Primitive/共通WGSL検証");
        }
    }
}
