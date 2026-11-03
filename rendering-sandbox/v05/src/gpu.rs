use std::borrow::Cow;
use wgpu::util::DeviceExt;

pub fn buffer(
    device: &wgpu::Device,
    name: &str,
    size: u64,
    usage: wgpu::BufferUsages,
) -> wgpu::Buffer {
    device.create_buffer(&wgpu::BufferDescriptor {
        label: Some(name),
        size,
        usage,
        mapped_at_creation: false,
    })
}
pub fn upload<T: bytemuck::Pod>(
    device: &wgpu::Device,
    name: &str,
    data: &[T],
    usage: wgpu::BufferUsages,
) -> wgpu::Buffer {
    device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
        label: Some(name),
        contents: bytemuck::cast_slice(data),
        usage,
    })
}
pub fn shader(device: &wgpu::Device, name: &str, parts: &[&str]) -> wgpu::ShaderModule {
    device.create_shader_module(wgpu::ShaderModuleDescriptor {
        label: Some(name),
        source: wgpu::ShaderSource::Wgsl(Cow::Owned(parts.join("\n"))),
    })
}
pub fn compute(
    device: &wgpu::Device,
    name: &str,
    module: &wgpu::ShaderModule,
    entry: &str,
    layout: Option<&wgpu::PipelineLayout>,
) -> wgpu::ComputePipeline {
    device.create_compute_pipeline(&wgpu::ComputePipelineDescriptor {
        label: Some(name),
        layout,
        module,
        entry_point: Some(entry),
        compilation_options: Default::default(),
        cache: None,
    })
}
pub fn group(
    device: &wgpu::Device,
    layout: &wgpu::BindGroupLayout,
    values: &[wgpu::BindingResource<'_>],
) -> wgpu::BindGroup {
    let entries: Vec<_> = values
        .iter()
        .enumerate()
        .map(|(i, r)| wgpu::BindGroupEntry {
            binding: i as u32,
            resource: r.clone(),
        })
        .collect();
    device.create_bind_group(&wgpu::BindGroupDescriptor {
        label: None,
        layout,
        entries: &entries,
    })
}
pub fn layout(
    device: &wgpu::Device,
    entries: &[(u32, wgpu::ShaderStages, wgpu::BindingType)],
) -> wgpu::BindGroupLayout {
    device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
        label: None,
        entries: &entries
            .iter()
            .map(|(binding, visibility, ty)| wgpu::BindGroupLayoutEntry {
                binding: *binding,
                visibility: *visibility,
                ty: *ty,
                count: None,
            })
            .collect::<Vec<_>>(),
    })
}
pub fn uniform() -> wgpu::BindingType {
    wgpu::BindingType::Buffer {
        ty: wgpu::BufferBindingType::Uniform,
        has_dynamic_offset: false,
        min_binding_size: None,
    }
}
pub fn storage(read_only: bool) -> wgpu::BindingType {
    wgpu::BindingType::Buffer {
        ty: wgpu::BufferBindingType::Storage { read_only },
        has_dynamic_offset: false,
        min_binding_size: None,
    }
}
pub fn texture(
    device: &wgpu::Device,
    name: &str,
    size: [u32; 2],
    format: wgpu::TextureFormat,
    usage: wgpu::TextureUsages,
    mips: u32,
) -> wgpu::Texture {
    device.create_texture(&wgpu::TextureDescriptor {
        label: Some(name),
        size: wgpu::Extent3d {
            width: size[0],
            height: size[1],
            depth_or_array_layers: 1,
        },
        mip_level_count: mips,
        sample_count: 1,
        dimension: wgpu::TextureDimension::D2,
        format,
        usage,
        view_formats: &[],
    })
}
pub fn pipeline(
    device: &wgpu::Device,
    name: &str,
    module: &wgpu::ShaderModule,
    vs: &str,
    fs: Option<&str>,
    layouts: &[&wgpu::BindGroupLayout],
    format: wgpu::TextureFormat,
    depth: Option<(wgpu::CompareFunction, bool)>,
    topology: wgpu::PrimitiveTopology,
    cull: Option<wgpu::Face>,
) -> wgpu::RenderPipeline {
    let pl = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
        label: Some(name),
        bind_group_layouts: layouts,
        push_constant_ranges: &[],
    });
    let targets = [Some(wgpu::ColorTargetState {
        format,
        blend: None,
        write_mask: wgpu::ColorWrites::ALL,
    })];
    device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
        label: Some(name),
        layout: Some(&pl),
        vertex: wgpu::VertexState {
            module,
            entry_point: Some(vs),
            compilation_options: Default::default(),
            buffers: &[],
        },
        fragment: fs.map(|entry| wgpu::FragmentState {
            module,
            entry_point: Some(entry),
            compilation_options: Default::default(),
            targets: if format.is_depth_stencil_format() { &[] } else { &targets },
        }),
        primitive: wgpu::PrimitiveState {
            topology,
            cull_mode: cull,
            ..Default::default()
        },
        depth_stencil: depth.map(
            |(depth_compare, depth_write_enabled)| wgpu::DepthStencilState {
                format: wgpu::TextureFormat::Depth32Float,
                depth_write_enabled,
                depth_compare,
                stencil: Default::default(),
                bias: Default::default(),
            },
        ),
        multisample: Default::default(),
        multiview: None,
        cache: None,
    })
}

#[cfg(test)]
mod tests {
    #[test]
    fn subgroup_and_workgroup_shader_variants_validate() {
        let common = include_str!("shaders/tile-common.wgsl");
        let variants = [
            vec![
                common,
                include_str!("shaders/cull.wgsl"),
                include_str!("shaders/compact-workgroup.wgsl"),
            ],
            vec![
                common,
                include_str!("shaders/cull.wgsl"),
                include_str!("shaders/compact-subgroup.wgsl"),
            ],
            vec![
                common,
                include_str!("shaders/foliage-compute.wgsl"),
                include_str!("shaders/foliage-compact-workgroup.wgsl"),
            ],
            vec![
                common,
                include_str!("shaders/foliage-compute.wgsl"),
                include_str!("shaders/foliage-compact-subgroup.wgsl"),
            ],
        ];
        for parts in variants {
            let code = parts.join("\n");
            let module = naga::front::wgsl::parse_str(&code).expect("WGSL構文");
            naga::valid::Validator::new(
                naga::valid::ValidationFlags::all(),
                naga::valid::Capabilities::all(),
            )
            .validate(&module)
            .expect("WGSL検査");
        }
    }
}
