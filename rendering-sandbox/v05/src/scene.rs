use bytemuck::{Pod, Zeroable};
use glam::{Mat4, Vec3, Vec4};

#[derive(Clone, PartialEq)]
pub struct Settings {
    pub screen_shadow: crate::screen_shadow::Settings,
    pub seed: u32,
    pub amplitude: f32,
    pub mountain_scale: f32,
    pub density: u32,
    pub radius: f32,
    pub snap: bool,
    pub culling: bool,
    pub freeze: bool,
    pub caster_volume: bool,
    pub wire: bool,
    pub normals: bool,
    pub tile_colors: bool,
    pub height_colors: bool,
    pub height_grid: bool,
    pub azimuth: f32,
    pub elevation: f32,
    pub direct: bool,
    pub shadows: bool,
    pub shadow_distance: f32,
    pub depth_bias: f32,
    pub normal_bias: f32,
    pub pcf: u32,
    pub sky: f32,
    pub aerial: bool,
    pub specular: bool,
    pub albedo: [f32; 3],
    pub constant_albedo: bool,
    pub roughness: f32,
    pub metallic: f32,
    pub ev: f32,
    pub fov: f32,
    pub debug: u32,
    pub linear_distance: f32,
    pub sky_debug: bool,
    pub specular_debug: bool,
    pub shadow_debug: bool,
    pub csm_colors: bool,
    pub csm_grid: bool,
    pub shadow_mask: bool,
    pub grid_texels: f32,
    pub trees: bool,
    pub tree_density: f32,
    pub tree_budget: u32,
    pub tree_debug: u32,
    pub leaf_lod: i32,
    pub animate: bool,
    pub modeler_silhouette: bool,
}
impl Default for Settings {
    fn default() -> Self {
        Self {
            screen_shadow: Default::default(),
            seed: 12343725,
            amplitude: 2000.,
            mountain_scale: 3100.,
            density: 4,
            radius: 16000.,
            snap: true,
            culling: true,
            freeze: false,
            caster_volume: true,
            wire: false,
            normals: false,
            tile_colors: false,
            height_colors: false,
            height_grid: false,
            azimuth: 60.,
            elevation: 30.,
            direct: true,
            shadows: true,
            shadow_distance: 256.,
            depth_bias: 0.03,
            normal_bias: 0.1,
            pcf: 1,
            sky: 1.,
            aerial: true,
            specular: true,
            albedo: [1.; 3],
            constant_albedo: false,
            roughness: 0.8,
            metallic: 0.,
            ev: 0.,
            fov: 60.,
            debug: 0,
            linear_distance: 1000.,
            sky_debug: false,
            specular_debug: false,
            shadow_debug: false,
            csm_colors: false,
            csm_grid: false,
            shadow_mask: false,
            grid_texels: 16.,
            trees: true,
            tree_density: 0.3,
            tree_budget: 4,
            tree_debug: 0,
            leaf_lod: -1,
            animate: false,
            modeler_silhouette: false,
        }
    }
}
#[derive(Clone)]
pub struct Camera {
    pub position: Vec3,
    pub yaw: f32,
    pub pitch: f32,
    pub speed: f32,
}
impl Default for Camera {
    fn default() -> Self {
        Self {
            position: Vec3::new(0., 200., 0.),
            yaw: 0.,
            pitch: 0.,
            speed: 80.,
        }
    }
}
impl Camera {
    pub fn forward(&self) -> Vec3 {
        Vec3::new(
            -self.yaw.sin() * self.pitch.cos(),
            -self.pitch.sin(),
            -self.yaw.cos() * self.pitch.cos(),
        )
    }
    pub fn rays(&self, aspect: f32, fov: f32) -> [[f32; 4]; 3] {
        let t = (fov.to_radians() * 0.5).tan();
        [
            self.forward().extend(0.).to_array(),
            (Vec3::new(self.yaw.cos(), 0., -self.yaw.sin()) * t * aspect)
                .extend(0.)
                .to_array(),
            (Vec3::new(
                -self.yaw.sin() * self.pitch.sin(),
                self.pitch.cos(),
                -self.yaw.cos() * self.pitch.sin(),
            ) * t)
                .extend(0.)
                .to_array(),
        ]
    }
    pub fn matrix(&self, aspect: f32, fov: f32) -> Mat4 {
        Mat4::perspective_infinite_reverse_rh(fov.to_radians(), aspect, 1.)
            * Mat4::look_to_rh(self.position, self.forward(), Vec3::Y)
    }
}
pub fn light(s: &Settings) -> Vec3 {
    let a = s.azimuth.to_radians();
    let e = s.elevation.to_radians();
    Vec3::new(a.sin() * e.cos(), e.sin(), a.cos() * e.cos())
}
pub fn planes(m: Mat4) -> [[f32; 4]; 6] {
    let r = m.transpose();
    let x = r.x_axis;
    let y = r.y_axis;
    let z = r.z_axis;
    let w = r.w_axis;
    [w + x, w - x, w + y, w - y, z, w - z].map(|v| {
        let length = v.truncate().length();
        if length > 1e-7 {
            (v / length).to_array()
        } else {
            v.to_array()
        }
    })
}
#[repr(C)]
#[derive(Clone, Copy, Pod, Zeroable)]
pub struct Scene {
    pub matrix: [[f32; 4]; 4],
    pub planes: [[f32; 4]; 6],
    pub light: [f32; 4],
    pub elevation: [f32; 4],
    pub domain: [f32; 4],
    pub terrain: [f32; 4],
    pub layout: [u32; 4],
    pub cascades: [[f32; 4]; 8],
    pub windows: [[i32; 4]; 7],
    pub caster_planes: [[f32; 4]; 16],
    pub caster_info: [u32; 4],
}
// WGSLのLightingと同じ順序・オフセット。repr(C)だけに頼らずテストで照合する。
#[repr(C, align(16))]
#[derive(Clone, Copy, Pod, Zeroable)]
pub struct Lighting {
    pub shadow_view_projection: [[f32; 4]; 4],
    pub light: [f32; 4],
    pub shadow: [f32; 4],
    pub filter: [f32; 4],
    pub sky_diffuse: [f32; 4],
    pub camera_position: [f32; 4],
    pub atmosphere: [f32; 4],
    pub shadow_matrices: [[[f32; 4]; 4]; 4],
    pub splits: [f32; 4],
    pub view_forward: [f32; 4],
    pub material: [f32; 4],
}
#[repr(C, align(16))]
#[derive(Clone, Copy, Pod, Zeroable)]
pub struct CameraUniform {
    pub pre_exposure: f32,
    pub inverse: f32,
    pub previous: f32,
    pub history_to_current: f32,
}
pub fn layout(s: &Settings) -> (u32, u32) {
    let mut levels = 1;
    while levels < 8 && (128. - 8. / s.density as f32) * 2f32.powi(levels - 1) < s.radius {
        levels += 1;
    }
    (
        levels as u32,
        s.density * s.density + (levels as u32 - 1) * s.density * s.density * 3 / 4,
    )
}
pub fn scene(s: &Settings, c: &Camera, m: Mat4, windows: [[i32; 4]; 7]) -> Scene {
    let (levels, count) = layout(s);
    let bound = s.amplitude * 0.75 + 2.;
    let mut out = Scene::zeroed();
    out.matrix = m.to_cols_array_2d();
    out.planes = planes(m);
    out.light = light(s).extend(0.).to_array();
    out.elevation = [
        -bound,
        1. / (2. * bound),
        s.normals as u32 as f32,
        s.tile_colors as u32 as f32,
    ];
    out.domain = [
        1024.,
        (levels - 1).max(1) as f32,
        1.,
        s.height_colors as u32 as f32,
    ];
    out.terrain = [0., -bound, bound, s.height_grid as u32 as f32];
    out.layout = [s.density, levels, count, s.culling as u32];
    out.windows = windows;
    for l in 0..levels as usize {
        let step = 4. / s.density as f32 * 2f32.powi(l as i32);
        let period = 2. * step;
        out.cascades[l] = [
            if s.snap {
                (c.position.x / period).floor() * period
            } else {
                c.position.x
            },
            if s.snap {
                (c.position.z / period).floor() * period
            } else {
                c.position.z
            },
            step,
            128. * 2f32.powi(l as i32),
        ];
    }
    out
}
pub struct Cascade {
    pub matrix: Mat4,
    pub split: f32,
    pub caster: Vec<[f32; 4]>,
}
pub fn cascades(s: &Settings, c: &Camera, aspect: f32) -> Vec<Cascade> {
    let rays = c.rays(aspect, s.fov);
    let f = Vec3::from_slice(&rays[0]);
    let r = Vec3::from_slice(&rays[1]);
    let u = Vec3::from_slice(&rays[2]);
    let l = light(s);
    let splits: [f32; 4] = std::array::from_fn(|i| {
        let t = (i + 1) as f32 / 4.;
        0.9 * s.shadow_distance.powf(t) + 0.1 * (1. + (s.shadow_distance - 1.) * t)
    });
    (0..4)
        .map(|i| {
            let far = splits[i];
            let start = if i < 2 { 1. } else { splits[i - 2] };
            let near = if i == 0 {
                1.
            } else {
                start + (splits[i - 1] - start) * 0.9
            };
            let center = c.position + f * ((near + far) * 0.5);
            let tangent = (s.fov.to_radians() * 0.5).tan();
            let radius = ((Vec3::new(far * tangent * aspect, far * tangent, (far - near) * 0.5)
                .length()
                * 16.)
                .ceil()
                / 16.)
                * 1024.
                / 1016.;
            let levels = layout(s).0;
            let extent =
                2f32.sqrt() * 128. * 2f32.powi(levels as i32 - 1) + s.amplitude * 0.75 + 18.;
            let depth = extent
                + l.dot(center - Vec3::new(c.position.x, 0., c.position.z))
                    .abs()
                + 16.;
            let right = Vec3::Y.cross(l).normalize();
            let up = l.cross(right);
            let texel = 2. * radius / 1024.;
            let cx = (right.dot(center) / texel).floor() * texel;
            let cy = (up.dot(center) / texel).floor() * texel;
            let cz = l.dot(center);
            let z = 1. / (2. * depth);
            let matrix = Mat4::from_cols(
                Vec4::new(right.x / radius, up.x / radius, l.x * z, 0.),
                Vec4::new(right.y / radius, up.y / radius, l.y * z, 0.),
                Vec4::new(right.z / radius, up.z / radius, l.z * z, 0.),
                Vec4::new(-cx / radius, -cy / radius, 0.5 - cz * z, 1.),
            );
            let corners: Vec<Vec3> = [near, far]
                .into_iter()
                .flat_map(|d| {
                    [-1., 1.].into_iter().flat_map(move |y| {
                        [-1., 1.].map(move |x| c.position + (f + r * x + u * y) * d)
                    })
                })
                .collect();
            Cascade {
                matrix,
                split: far,
                caster: caster_planes(&corners, l),
            }
        })
        .collect()
}
fn caster_planes(p: &[Vec3], light: Vec3) -> Vec<[f32; 4]> {
    let center = p.iter().copied().sum::<Vec3>() / 8.;
    let faces = [
        [0, 2, 6],
        [1, 5, 7],
        [0, 4, 5],
        [2, 3, 7],
        [0, 1, 3],
        [4, 6, 7],
    ]
    .map(|[a, b, c]| {
        let mut n = (p[b] - p[a]).cross(p[c] - p[a]).normalize();
        if n.dot(center - p[a]) < 0. {
            n = -n;
        }
        (n, -n.dot(p[a]), n.dot(light) >= 0.)
    });
    let mut out: Vec<_> = faces
        .iter()
        .filter(|f| f.2)
        .map(|f| f.0.extend(f.1).to_array())
        .collect();
    for [a, b, i, j] in [
        [0, 1, 2, 4],
        [1, 3, 1, 4],
        [3, 2, 3, 4],
        [2, 0, 0, 4],
        [4, 5, 2, 5],
        [5, 7, 1, 5],
        [7, 6, 3, 5],
        [6, 4, 0, 5],
        [0, 4, 0, 2],
        [1, 5, 1, 2],
        [2, 6, 0, 3],
        [3, 7, 1, 3],
    ] {
        if faces[i].2 == faces[j].2 {
            continue;
        }
        let raw = (p[b] - p[a]).cross(light);
        if raw.length() < 1e-8 {
            continue;
        }
        let mut n = raw.normalize();
        if n.dot(center - p[a]) < 0. {
            n = -n;
        }
        out.push(n.extend(-n.dot(p[a])).to_array());
    }
    out
}
pub fn indices() -> (Vec<u16>, Vec<u16>) {
    let mut out = Vec::new();
    for bz in (0..64).step_by(8) {
        for bx in (0..64).step_by(8) {
            for z in bz..bz + 8 {
                for x in bx..bx + 8 {
                    let a = (z * 65 + x) as u16;
                    let b = a + 1;
                    let c = a + 65;
                    let d = c + 1;
                    if (x + z) % 2 == 0 {
                        out.extend([a, c, d, a, d, b]);
                    } else {
                        out.extend([a, c, b, b, c, d]);
                    }
                }
            }
        }
    }
    let mut seen = std::collections::HashSet::new();
    let mut wire = Vec::new();
    for tri in out.chunks_exact(3) {
        for i in 0..3 {
            let a = tri[i];
            let b = tri[(i + 1) % 3];
            if seen.insert((a.min(b), a.max(b))) {
                wire.extend([a, b]);
            }
        }
    }
    (out, wire)
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn gpu_layout_and_reversed_depth() {
        assert_eq!(std::mem::size_of::<Scene>(), 752);
        assert_eq!(std::mem::size_of::<Lighting>(), 464);
        assert_eq!(std::mem::offset_of!(Lighting, shadow_matrices), 160);
        assert_eq!(std::mem::offset_of!(Lighting, material), 448);
        assert_eq!(std::mem::size_of::<CameraUniform>(), 16);
        assert_eq!(std::mem::offset_of!(Scene, windows), 368);
        assert_eq!(std::mem::offset_of!(Scene, caster_info), 736);
        let c = Camera::default();
        let m = c.matrix(1., 60.);
        for d in [1., 10., 10000.] {
            let p = m * (c.position + c.forward() * d).extend(1.);
            assert!((p.z / p.w - 1. / d).abs() < 1e-5);
        }
    }
    #[test]
    fn tile_and_cascade_bounds() {
        let (ib, _) = indices();
        assert_eq!(ib.len(), 64 * 64 * 6);
        assert!(ib.iter().all(|i| *i < 65 * 65));
        let s = Settings::default();
        assert_eq!(layout(&s).0, 8);
        for c in cascades(&s, &Camera::default(), 1.8) {
            assert!(c.caster.len() <= 16);
            assert!(c.matrix.is_finite());
        }
    }
}
