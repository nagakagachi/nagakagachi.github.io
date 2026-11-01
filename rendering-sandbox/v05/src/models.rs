use bytemuck::{Pod, Zeroable};
use glam::{Quat, Vec3};
use std::f32::consts::PI;
#[derive(Clone)]
pub struct Mesh {
    pub vertices: Vec<f32>,
    pub indices: Vec<u16>,
    pub stride: usize,
}
#[derive(Clone)]
struct Leaf {
    p: Vec3,
    u: Vec3,
    v: Vec3,
    w: f32,
    h: f32,
    color: Vec3,
}
#[derive(Clone)]
struct Branch {
    a: Vec3,
    b: Vec3,
    r0: f32,
    r1: f32,
}
#[derive(Clone)]
pub struct Cluster {
    branches: Vec<Branch>,
    leaves: Vec<Leaf>,
}
#[repr(C)]
#[derive(Clone, Copy, Pod, Zeroable)]
pub struct Socket {
    pub position: [f32; 4],
    pub rotation: [f32; 4],
    pub ids: [u32; 4],
}
pub struct Tree {
    pub branches: Vec<Vec<Vec3>>,
    pub births: Vec<f32>,
    pub sockets: Vec<Socket>,
    pub min: Vec3,
    pub max: Vec3,
}
#[derive(Clone, PartialEq)]
pub struct ModelSettings {
    pub seed: u32,
    pub form: usize,
    pub height: f32,
    pub crown: f32,
    pub bend: f32,
    pub branches: usize,
    pub sockets: usize,
    pub class: usize,
    pub variation: usize,
    pub spread: f32,
    pub opening: f32,
    pub depth: f32,
    pub leaf_size: f32,
    pub shape: [f32; 20],
    pub radius: f32,
    pub taper: f32,
}
impl Default for ModelSettings {
    fn default() -> Self {
        Self {
            seed: 1234,
            form: 2,
            height: 8.,
            crown: 6.,
            bend: 0.8,
            branches: 3,
            sockets: 24,
            class: 2,
            variation: 1,
            spread: 1.,
            opening: 1.,
            depth: 1.,
            leaf_size: 1.,
            shape: preset(2),
            radius: 0.025,
            taper: 1.,
        }
    }
}
pub const SHAPE_NAMES: [&str; 20] = [
    "主幹の高さ比",
    "発生開始高さ",
    "発生終了高さ",
    "発生高さの偏り",
    "開始方位角",
    "方位角の間隔",
    "分岐角",
    "主要枝の長さ比",
    "高い位置での短縮",
    "外側へ曲がる角度",
    "曲がり開始位置",
    "先端の下垂",
    "不規則さ",
    "主幹への枝葉配分",
    "配置開始位置",
    "配置終了位置",
    "枝葉サイズ下部",
    "枝葉サイズ中部",
    "枝葉サイズ上部",
    "枝葉の上向き補正",
];
pub const SHAPE_RANGES: [(f32, f32); 20] = [
    (0.2, 1.),
    (0., 1.),
    (0., 1.),
    (0.25, 4.),
    (-180., 180.),
    (0., 180.),
    (0., 150.),
    (0.1, 1.),
    (0., 0.9),
    (-120., 120.),
    (0., 0.9),
    (0., 1.),
    (0., 1.),
    (0., 1.),
    (0., 0.9),
    (0.1, 1.),
    (0.1, 1.5),
    (0.1, 1.5),
    (0.1, 1.5),
    (-1., 1.),
];
pub fn preset(form: usize) -> [f32; 20] {
    let mut s = [
        0.85, 0.35, 0.85, 1., 0., 120., 50., 0.4, 0.2, 30., 0.25, 0., 0.2, 0.3, 0.25, 1., 0.7, 1.,
        0.55, 0.3,
    ];
    match form {
        0 => {
            s[0] = 1.;
            s[16] = 1.3;
            s[17] = 0.75;
            s[18] = 0.1;
        }
        1 => {
            s[0] = 0.95;
            s[1] = 0.3;
            s[2] = 0.75;
            s[6] = 25.;
            s[9] = 10.;
            s[16] = 0.55;
            s[18] = 0.4;
        }
        3 => {
            s[0] = 0.9;
            s[1] = 0.8;
            s[2] = 0.95;
            s[6] = 85.;
            s[9] = 0.;
            s[7] = 0.45;
            s[13] = 0.25;
            s[14] = 0.65;
            s[16] = 0.8;
            s[18] = 1.;
            s[19] = 0.5;
        }
        4 => {
            s[0] = 0.55;
            s[1] = 0.3;
            s[2] = 0.65;
            s[6] = 25.;
            s[7] = 0.7;
            s[9] = 25.;
            s[13] = 0.;
            s[16] = 0.3;
            s[17] = 0.65;
            s[18] = 1.;
        }
        5 => {
            s[1] = 0.65;
            s[2] = 0.9;
            s[6] = 45.;
            s[7] = 0.55;
            s[9] = 100.;
            s[10] = 0.1;
            s[11] = 0.35;
            s[13] = 0.15;
            s[18] = 0.7;
            s[19] = -0.6;
        }
        _ => {}
    }
    s
}
struct Random(u32);
impl Random {
    fn next(&mut self) -> f32 {
        self.0 = self.0.wrapping_mul(1664525).wrapping_add(1013904223);
        self.0 as f64 as f32 / 4294967296.
    }
}
fn vertex(v: &mut Vec<f32>, p: Vec3, n: Vec3, color: Vec3) {
    v.extend(p.to_array());
    v.extend(n.to_array());
    v.extend(color.to_array());
}
fn corners(l: &Leaf) -> [Vec3; 4] {
    [
        l.p + l.u * l.w,
        l.p + l.v * l.h,
        l.p - l.u * l.w,
        l.p - l.v * l.h,
    ]
}
pub fn clusters(p: &ModelSettings) -> Vec<Vec<Cluster>> {
    [(2, 10, 0.7), (4, 20, 0.85), (4, 52, 1.)]
        .into_iter()
        .map(|(segments, count, extent)| {
            (0..4)
                .map(|variation| {
                    let (width, depth, rise, length, leaf_width, color) = match variation {
                        0 => (1.2, 0.8, 0.9, 0.85, 0.44, Vec3::new(0.065, 0.23, 0.045)),
                        1 => (0.85, 1.1, 1.3, 0.9, 0.48, Vec3::new(0.095, 0.29, 0.045)),
                        2 => (1.15, 0.9, 0.4, 0.95, 0.4, Vec3::new(0.05, 0.2, 0.075)),
                        _ => (0.9, 0.8, 1.1, 1.1, 0.075, Vec3::new(0.035, 0.15, 0.055)),
                    };
                    let mut random = Random(p.seed);
                    let mut branches = Vec::new();
                    let stem = segments > 2;
                    let limbs = if stem { segments - 1 } else { segments };
                    if stem {
                        branches.push(Branch {
                            a: Vec3::ZERO,
                            b: Vec3::new(0.04, 0.6 * extent, 0.),
                            r0: 0.065,
                            r1: 0.036,
                        });
                    }
                    for limb in 0..limbs {
                        let angle = limb as f32 / limbs as f32 * 2. * PI + 0.3;
                        let az = if variation == 1 {
                            angle
                        } else {
                            [-2.65, -0.15, 1.25][limb]
                        };
                        let a = if stem {
                            Vec3::new(
                                0.04 * (0.4 + limb as f32 * 0.25),
                                (0.23 + limb as f32 * 0.16) * extent,
                                0.,
                            )
                        } else {
                            Vec3::ZERO
                        };
                        let reach = extent * width * p.spread * (0.95 + random.next() * 0.1);
                        branches.push(Branch {
                            a,
                            b: Vec3::new(
                                az.cos() * reach,
                                (rise + 0.3 * angle.sin()) * extent,
                                az.sin() * reach * depth * p.depth,
                            ),
                            r0: 0.035 * extent,
                            r1: 0.008 * extent,
                        });
                    }
                    let leaves = (0..count)
                        .map(|i| {
                            let group = i % limbs;
                            let slot = i / limbs;
                            let count = (count - group).div_ceil(limbs);
                            let t = (slot as f32 + 0.5) / count as f32;
                            let b = &branches[group + stem as usize];
                            let delta = b.b - b.a;
                            let axis = delta.normalize();
                            let side = axis
                                .cross(if axis.y.abs() < 0.95 {
                                    Vec3::Y
                                } else {
                                    Vec3::Z
                                })
                                .normalize();
                            let up = side.cross(axis);
                            let phase = slot as f32 * 2.399963
                                + group as f32 * 0.7
                                + (random.next() - 0.5) * 0.3;
                            let outward = side * phase.cos() + up * phase.sin();
                            let base = b.a + delta * (0.18 + 0.82 * t);
                            let direction = (axis * if variation == 3 { 0.9 } else { 0.35 }
                                + outward * (0.8 * p.opening)
                                + Vec3::Y * if variation == 2 { -0.3 } else { 0.2 })
                            .normalize();
                            let taper = 0.75 + 0.25 * (PI * t).sin();
                            let length =
                                length * p.leaf_size * (0.85 + random.next() * 0.3) * taper;
                            let width =
                                leaf_width * p.leaf_size * (0.85 + random.next() * 0.3) * taper;
                            let raw = direction.cross(Vec3::new(
                                0.35 * phase.cos(),
                                0.8,
                                0.35 * phase.sin(),
                            ));
                            let u0 = if raw.length() > 1e-5 {
                                raw.normalize()
                            } else {
                                direction
                                    .cross(if direction.y.abs() < 0.9 {
                                        Vec3::Y
                                    } else {
                                        Vec3::Z
                                    })
                                    .normalize()
                            };
                            let n0 = u0.cross(direction);
                            let roll =
                                (random.next() - 0.5) * 1.5 + (slot as i32 % 3 - 1) as f32 * 0.25;
                            let u = u0 * roll.cos() + n0 * roll.sin();
                            Leaf {
                                p: base + direction * length / 2.,
                                u,
                                v: direction,
                                w: width / 2.,
                                h: length / 2.,
                                color: color * (0.75 + random.next() * 0.25),
                            }
                        })
                        .collect();
                    Cluster { branches, leaves }
                })
                .collect()
        })
        .collect()
}
const BUDGET: [[(usize, usize); 4]; 3] = [
    [(2, 10), (1, 5), (0, 3), (0, 2)],
    [(4, 20), (2, 10), (1, 5), (0, 3)],
    [(4, 52), (2, 26), (1, 13), (0, 6)],
];
fn reduce(source: &[Leaf], count: usize, lod: usize) -> Vec<Leaf> {
    let mut min = Vec3::splat(f32::INFINITY);
    let mut max = -min;
    for p in source.iter().flat_map(corners) {
        min = min.min(p);
        max = max.max(p);
    }
    let size = (max - min).max(Vec3::splat(0.01));
    let dist = |i: usize, j: usize| {
        ((source[i].p - source[j].p) / size).length_squared()
            + 0.12
                * (1.
                    - source[i]
                        .u
                        .cross(source[i].v)
                        .dot(source[j].u.cross(source[j].v))
                        .abs())
    };
    let first = (0..source.len())
        .max_by(|a, b| (source[*a].w * source[*a].h).total_cmp(&(source[*b].w * source[*b].h)))
        .unwrap_or(0);
    let mut selected = vec![first];
    while selected.len() < count {
        let best = (0..source.len())
            .filter(|i| !selected.contains(i))
            .max_by(|a, b| {
                let score = |i| {
                    selected
                        .iter()
                        .map(|j| dist(i, *j))
                        .fold(f32::INFINITY, f32::min)
                };
                score(*a).total_cmp(&score(*b))
            })
            .expect("LOD予算内");
        selected.push(best);
    }
    let mut groups = vec![Vec::new(); count];
    for i in 0..source.len() {
        let g = (0..count)
            .min_by(|a, b| dist(i, selected[*a]).total_cmp(&dist(i, selected[*b])))
            .expect("代表葉あり");
        groups[g].push(i);
    }
    selected
        .iter()
        .enumerate()
        .map(|(g, i)| {
            let mut leaf = source[*i].clone();
            let members = if groups[g].is_empty() {
                vec![*i]
            } else {
                groups[g].clone()
            };
            let mut area = 0.;
            let mut center = Vec3::ZERO;
            let mut color = Vec3::ZERO;
            for j in &members {
                let s = &source[*j];
                let a = s.w * s.h;
                area += a;
                center += s.p * a;
                color += s.color * a;
            }
            leaf.p = leaf.p * 0.65 + center * (0.35 / area);
            leaf.color = color / area;
            let (mut w, mut h) = (leaf.w, leaf.h);
            for p in members.iter().flat_map(|j| corners(&source[*j])) {
                let d = p - leaf.p;
                w = w.max(d.dot(leaf.u).abs());
                h = h.max(d.dot(leaf.v).abs());
            }
            let cap = [1., 1.8, 2.6, 3.6][lod];
            w = w.min(leaf.w * cap);
            h = h.min(leaf.h * cap);
            let mut fit = 1f32;
            for d in [leaf.u * w, -leaf.u * w, leaf.v * h, -leaf.v * h] {
                for j in 0..3 {
                    if d[j].abs() > 1e-8 {
                        fit = fit.min(if d[j] > 0. {
                            (max[j] - leaf.p[j]) / d[j].abs()
                        } else {
                            (leaf.p[j] - min[j]) / d[j].abs()
                        });
                    }
                }
            }
            leaf.w = w * fit.max(0.01);
            leaf.h = h * fit.max(0.01);
            leaf
        })
        .collect()
}
pub fn cluster_mesh(source: &[Cluster], class: usize, lod: usize) -> Mesh {
    let (branches, count) = BUDGET[class][lod];
    let mut out = Mesh {
        vertices: Vec::new(),
        indices: Vec::new(),
        stride: branches * 6 + count * 4,
    };
    for b in 0..branches {
        for i in 0..3 {
            let j = (i + 1) % 3;
            let a = (b * 6) as u16;
            out.indices
                .extend([a + i, a + j, a + 3 + i, a + j, a + 3 + j, a + 3 + i]);
        }
    }
    for l in 0..count {
        let a = (branches * 6 + l * 4) as u16;
        out.indices.extend([a, a + 1, a + 2, a, a + 2, a + 3]);
    }
    for cluster in source {
        let mut chosen: Vec<_> = cluster.branches.iter().enumerate().collect();
        if lod > 0 {
            chosen.sort_by(|(i, a), (j, b)| {
                if i == j {
                    std::cmp::Ordering::Equal
                } else if *i == 0 {
                    std::cmp::Ordering::Less
                } else if *j == 0 {
                    std::cmp::Ordering::Greater
                } else {
                    (b.b - b.a).length().total_cmp(&(a.b - a.a).length())
                }
            });
        }
        for (_, b) in chosen.iter().take(branches) {
            let axis = (b.b - b.a).normalize();
            let u = if axis.y.abs() < 0.9 { Vec3::Y } else { Vec3::X }
                .cross(axis)
                .normalize();
            let v = axis.cross(u);
            for ring in 0..2 {
                for i in 0..3 {
                    let a = i as f32 * 2. * PI / 3.;
                    let radial = u * a.cos() + v * a.sin();
                    vertex(
                        &mut out.vertices,
                        if ring == 0 {
                            b.a + radial * b.r0
                        } else {
                            b.b + radial * b.r1
                        },
                        (radial + axis * ((b.r0 - b.r1) / (b.b - b.a).length())).normalize(),
                        Vec3::new(0.11, 0.055, 0.023),
                    );
                }
            }
        }
        let leaves = if lod == 0 {
            cluster.leaves.clone()
        } else {
            reduce(&cluster.leaves, count, lod)
        };
        for l in leaves {
            for p in corners(&l) {
                vertex(&mut out.vertices, p, l.u.cross(l.v), l.color);
            }
        }
    }
    out
}
fn sample(points: &[Vec3], t: f32) -> (Vec3, Vec3) {
    let at = t.clamp(0., 1.) * (points.len() - 1) as f32;
    let i = (at as usize).min(points.len() - 2);
    (
        points[i].lerp(points[i + 1], at - i as f32),
        (points[i + 1] - points[i]).normalize(),
    )
}
pub fn tree(p: &ModelSettings, mesh: &Mesh) -> Tree {
    let s = p.shape;
    let mut random = Random(p.seed);
    let points: Vec<_> = (0..=12)
        .map(|i| {
            let t = i as f32 / 12.;
            Vec3::new(
                p.bend * (t * PI * 0.8).sin() * t,
                p.height * s[0] * t,
                p.bend * 0.45 * ((t * PI * 1.2).cos() - 1.) * t,
            )
        })
        .collect();
    let mut branches = vec![points];
    let mut births = vec![0.];
    for i in 0..p.branches {
        let birth = s[1] + (s[2] - s[1]) * ((i as f32 + 0.5) / p.branches as f32).powf(s[3]);
        let (position, _) = sample(&branches[0], birth);
        let angle = (s[4] + i as f32 * s[5] + (random.next() - 0.5) * 60. * s[12]).to_radians();
        let length =
            p.height * s[7] * (1. - s[8] * birth) * (1. + (random.next() - 0.5) * 0.4 * s[12]);
        let inclination = (s[6] + (random.next() - 0.5) * 30. * s[12]).to_radians();
        let mut pts = vec![position];
        for j in 1..=8 {
            let u = (j as f32 - 0.5) / 8.;
            let curve = ((u - s[10]) / (1. - s[10])).max(0.);
            let theta = inclination + s[9].to_radians() * curve;
            let last = pts[j - 1];
            pts.push(
                last + Vec3::new(
                    angle.cos() * theta.sin() * length / 8.,
                    theta.cos() * length / 8.
                        - p.height
                            * s[11]
                            * ((j as f32 / 8.).powi(2) - ((j - 1) as f32 / 8.).powi(2)),
                    angle.sin() * theta.sin() * length / 8.,
                ),
            );
        }
        branches.push(pts);
        births.push(birth);
    }
    let core = if p.branches > 0 {
        (p.sockets as f32 * s[13]).round() as usize
    } else {
        p.sockets
    };
    let mut sockets = Vec::new();
    let variation = p.variation;
    let extent = mesh
        .vertices
        .chunks_exact(9)
        .skip(variation * mesh.stride)
        .take(mesh.stride)
        .map(|v| Vec3::from_slice(v).length())
        .fold(0f32, f32::max);
    for i in 0..p.sockets {
        let is_core = i < core;
        let distributed = i.saturating_sub(core);
        let branch = if is_core || p.branches == 0 {
            0
        } else {
            1 + distributed % p.branches
        };
        let slot = if is_core {
            i
        } else if p.branches > 0 {
            distributed / p.branches
        } else {
            i
        };
        let count = if is_core {
            core
        } else if p.branches > 0 {
            (p.sockets - core - (branch - 1)).div_ceil(p.branches)
        } else {
            p.sockets
        };
        let u = (slot as f32 + 0.5) / count as f32;
        let t = s[14] + (s[15] - s[14]) * u;
        let (position, tangent) = sample(&branches[branch], t);
        let az = i as f32 * 2.399963 + (random.next() - 0.5) * 0.2;
        let radial = Vec3::new(az.cos(), 0., az.sin());
        let direction =
            (tangent * 0.8 + radial * if branch == 0 { 1. } else { 0.4 } + Vec3::Y * s[19])
                .normalize();
        let envelope = if u * 2. < 1. {
            s[16] + (s[17] - s[16]) * u * 2.
        } else {
            s[17] + (s[18] - s[17]) * (u * 2. - 1.)
        };
        let radius = p.crown * 0.3 * envelope * (1. + (random.next() - 0.5) * 0.3 * s[12]);
        sockets.push(Socket {
            position: position.extend(radius / extent.max(0.01)).to_array(),
            rotation: Quat::from_rotation_arc(Vec3::Y, direction).to_array(),
            ids: [variation as u32, 0, 0, 0],
        });
    }
    let mut min = Vec3::ZERO;
    let mut max = Vec3::ZERO;
    for b in &branches {
        for v in b {
            min = min.min(*v);
            max = max.max(*v);
        }
    }
    for socket in &sockets {
        for v in mesh
            .vertices
            .chunks_exact(9)
            .skip(variation * mesh.stride)
            .take(mesh.stride)
        {
            let p = Quat::from_array(socket.rotation) * Vec3::from_slice(v) * socket.position[3]
                + Vec3::from_slice(&socket.position);
            min = min.min(p);
            max = max.max(p);
        }
    }
    Tree {
        branches,
        births,
        sockets,
        min,
        max,
    }
}
pub fn wood(trees: &[Tree], p: &ModelSettings, lod: usize) -> Mesh {
    let (sides, trunk_segments, branch_segments): (usize, usize, usize) =
        [(8, 12, 8), (6, 6, 4), (4, 3, 2)][lod];
    let mut out = Mesh {
        vertices: Vec::new(),
        indices: Vec::new(),
        stride: 0,
    };
    for (variation, tree) in trees.iter().enumerate() {
        let mut vertices = Vec::new();
        for (id, points) in tree.branches.iter().enumerate() {
            let segments = if id == 0 {
                trunk_segments
            } else {
                branch_segments
            };
            let centers: Vec<_> = (0..=segments)
                .map(|i| sample(points, i as f32 / segments as f32).0)
                .collect();
            let base = vertices.len() / 9;
            let root_radius = p.height
                * p.radius
                * if id == 0 {
                    1.
                } else {
                    0.6 * (1. - tree.births[id]).powf(p.taper).max(0.15)
                };
            let mut previous = Vec3::Y;
            let mut normal = Vec3::X;
            for ring in 0..=segments {
                let a = centers[ring.saturating_sub(1)];
                let b = centers[(ring + 1).min(segments)];
                let tangent = (b - a).normalize();
                let axis = previous.cross(tangent);
                let cos = previous.dot(tangent);
                normal = if cos > -0.9999 {
                    (normal + axis.cross(normal) + axis.cross(axis.cross(normal)) / (1. + cos))
                        .normalize()
                } else {
                    tangent
                        .cross(if tangent.x.abs() < 0.8 {
                            Vec3::X
                        } else {
                            Vec3::Z
                        })
                        .normalize()
                };
                previous = tangent;
                let binormal = tangent.cross(normal);
                let radius_at = |i: usize| {
                    root_radius * (0.08 + 0.92 * (1. - i as f32 / segments as f32).powf(p.taper))
                };
                let radius = radius_at(ring);
                let slope = (radius_at((ring + 1).min(segments))
                    - radius_at(ring.saturating_sub(1)))
                    / (b - a).length().max(0.001);
                for side in 0..sides {
                    let angle = side as f32 / sides as f32 * 2. * PI;
                    let radial = normal * angle.cos() + binormal * angle.sin();
                    vertex(
                        &mut vertices,
                        centers[ring] + radial * radius,
                        (radial - tangent * slope).normalize(),
                        Vec3::new(0.19, 0.095, 0.038),
                    );
                }
            }
            if variation == 0 {
                for ring in 0..segments {
                    for side in 0..sides {
                        let a = (base + ring * sides + side) as u16;
                        let b = (base + ring * sides + (side + 1) % sides) as u16;
                        out.indices.extend([
                            a,
                            b,
                            a + sides as u16,
                            b,
                            b + sides as u16,
                            a + sides as u16,
                        ]);
                    }
                }
            }
            for end in [0, segments] {
                let at = vertices.len() / 9;
                let center = centers[end];
                let n = (center - centers[if end == 0 { 1 } else { segments - 1 }]).normalize();
                vertex(&mut vertices, center, n, Vec3::new(0.19, 0.095, 0.038));
                for side in 0..sides {
                    let source = (base + end * sides + side) * 9;
                    let v = Vec3::from_slice(&vertices[source..source + 3]);
                    vertex(&mut vertices, v, n, Vec3::new(0.19, 0.095, 0.038));
                }
                if variation == 0 {
                    for side in 0..sides {
                        let a = (at + 1 + side) as u16;
                        let b = (at + 1 + (side + 1) % sides) as u16;
                        out.indices.extend(if end == 0 {
                            [at as u16, b, a]
                        } else {
                            [at as u16, a, b]
                        });
                    }
                }
            }
        }
        if variation == 0 {
            out.stride = vertices.len() / 9;
        }
        assert_eq!(out.stride, vertices.len() / 9);
        out.vertices.extend(vertices);
    }
    out
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn shared_topology_lod_budgets() {
        let p = ModelSettings::default();
        let c = clusters(&p);
        for class in 0..3 {
            for lod in 0..4 {
                let m = cluster_mesh(&c[class], class, lod);
                let (b, l) = BUDGET[class][lod];
                assert_eq!(m.indices.len(), (b * 6 + l * 2) * 3);
                assert_eq!(m.vertices.len(), m.stride * 9 * 4);
                assert!(m.vertices.iter().all(|v| v.is_finite()));
                assert!(m.indices.iter().all(|i| (*i as usize) < m.stride));
            }
        }
    }
    #[test]
    fn skeleton_and_wood() {
        let p = ModelSettings::default();
        let c = clusters(&p);
        let m = cluster_mesh(&c[2], 2, 0);
        let t = tree(&p, &m);
        for (lod, expected) in [640, 264, 104].iter().enumerate() {
            let mesh = wood(std::slice::from_ref(&t), &p, lod);
            assert_eq!(mesh.indices.len() / 3, *expected);
            assert!(mesh.vertices.iter().all(|v| v.is_finite()));
        }
        assert_eq!(std::mem::size_of::<Socket>(), 48);
    }
}

#[cfg(test)]
mod range_tests {
    use super::*;
    #[test]
    fn every_form_and_branch_count_remains_finite() {
        for form in 0..6 {
            for branches in 0..=3 {
                let p = ModelSettings {
                    form,
                    shape: preset(form),
                    branches,
                    seed: 0xfffffff0,
                    ..Default::default()
                };
                let library = clusters(&p);
                let mesh = cluster_mesh(&library[p.class], p.class, 0);
                let tree = tree(&p, &mesh);
                assert_eq!(tree.sockets.len(), 24);
                assert!(tree.min.is_finite() && tree.max.is_finite());
                for lod in 0..3 {
                    let wood = wood(std::slice::from_ref(&tree), &p, lod);
                    assert!(wood.vertices.iter().all(|v| v.is_finite()));
                    assert!(wood.indices.iter().all(|i| (*i as usize) < wood.stride));
                }
            }
        }
    }
}
