use crate::{gpu::*, scene::Settings};
use wgpu::{BufferUsages as B, ShaderStages as S};

pub struct Heights {
    pub data: wgpu::Buffer,
    pipeline: wgpu::ComputePipeline,
    jobs: wgpu::Buffer,
    group: wgpu::BindGroup,
    previous: [Option<[i32; 2]>; 7],
    pub windows: [[i32; 4]; 7],
    key: (u32, u32, u32, u32),
}
impl Heights {
    pub fn new(d: &wgpu::Device) -> Self {
        let data = buffer(
            d,
            "FP16 Height Clipmap",
            7 * 1024 * 1024 * 2,
            B::STORAGE | B::COPY_SRC,
        );
        let jobs = buffer(d, "標高差分条件", 14 * 256, B::UNIFORM | B::COPY_DST);
        let mut entry = uniform();
        if let wgpu::BindingType::Buffer {
            ref mut has_dynamic_offset,
            ref mut min_binding_size,
            ..
        } = entry
        {
            *has_dynamic_offset = true;
            *min_binding_size = std::num::NonZeroU64::new(48);
        }
        let l = layout(
            d,
            &[(0, S::COMPUTE, entry), (1, S::COMPUTE, storage(false))],
        );
        let pl = d.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: None,
            bind_group_layouts: &[&l],
            push_constant_ranges: &[],
        });
        let pipeline = compute(
            d,
            "Height Clipmap",
            &shader(
                d,
                "generate-height",
                &[include_str!("shaders/generate-height.wgsl")],
            ),
            "generateMain",
            Some(&pl),
        );
        let group = group(
            d,
            &l,
            &[
                wgpu::BindingResource::Buffer(wgpu::BufferBinding {
                    buffer: &jobs,
                    offset: 0,
                    size: std::num::NonZeroU64::new(48),
                }),
                data.as_entire_binding(),
            ],
        );
        Self {
            data,
            pipeline,
            jobs,
            group,
            previous: [None; 7],
            windows: [[0; 4]; 7],
            key: (0, 0, 0, 0),
        }
    }
    pub fn encode(
        &mut self,
        q: &wgpu::Queue,
        e: &mut wgpu::CommandEncoder,
        s: &Settings,
        x: f32,
        z: f32,
    ) -> u32 {
        let count = (crate::scene::layout(s).0 - 1).max(1);
        let key = (
            s.seed,
            s.amplitude.to_bits(),
            s.mountain_scale.to_bits(),
            count,
        );
        if key != self.key {
            self.previous = [None; 7];
            self.key = key;
        }
        let mut jobs = Vec::new();
        for l in 0..count as usize {
            let step = 2f32.powi(l as i32);
            let next = [
                (x / (2. * step)).floor() as i32 * 2 - 512,
                (z / step).floor() as i32 - 512,
            ];
            self.windows[l] = [next[0], next[1], 0, 0];
            for rect in rects(self.previous[l], next) {
                jobs.push((l, rect));
            }
            self.previous[l] = Some(next);
        }
        if jobs.is_empty() {
            return 0;
        }
        let mut bytes = vec![0u32; jobs.len() * 64];
        let mut samples = 0;
        for (i, (l, rect)) in jobs.iter().enumerate() {
            let at = i * 64;
            for j in 0..4 {
                bytes[at + j] = rect[j] as u32;
            }
            bytes[at + 4] = *l as u32;
            bytes[at + 5] = s.seed;
            bytes[at + 8] = 2f32.powi(*l as i32).to_bits();
            bytes[at + 9] = s.amplitude.to_bits();
            bytes[at + 10] = s.mountain_scale.to_bits();
            samples += (rect[2] * rect[3]) as u32;
        }
        q.write_buffer(&self.jobs, 0, bytemuck::cast_slice(&bytes));
        let mut p = e.begin_compute_pass(&wgpu::ComputePassDescriptor {
            label: Some("Height Clipmap差分"),
            timestamp_writes: None,
        });
        p.set_pipeline(&self.pipeline);
        for (i, (_, r)) in jobs.iter().enumerate() {
            p.set_bind_group(0, &self.group, &[(i * 256) as u32]);
            p.dispatch_workgroups((r[2] as u32).div_ceil(16), (r[3] as u32).div_ceil(8), 1);
        }
        samples
    }
}
fn rects(old: Option<[i32; 2]>, n: [i32; 2]) -> Vec<[i32; 4]> {
    let Some(p) = old else {
        return vec![[n[0], n[1], 1024, 1024]];
    };
    let dx = n[0] - p[0];
    let dz = n[1] - p[1];
    if dx.abs() >= 1024 || dz.abs() >= 1024 {
        return vec![[n[0], n[1], 1024, 1024]];
    }
    let mut out = Vec::new();
    if dx != 0 {
        out.push([
            if dx > 0 { p[0] + 1024 } else { n[0] },
            n[1],
            dx.abs(),
            1024,
        ]);
    }
    if dz != 0 {
        out.push([
            p[0].max(n[0]),
            if dz > 0 { p[1] + 1024 } else { n[1] },
            1024 - dx.abs(),
            dz.abs(),
        ]);
    }
    out
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn strips_keep_overlap() {
        assert!(rects(Some([0, 0]), [0, 0]).is_empty());
        let r = rects(Some([0, 0]), [-2, 3]);
        assert_eq!(
            r.iter().map(|r| r[2] * r[3]).sum::<i32>(),
            2 * 1024 + 3 * 1022
        );
    }
}
