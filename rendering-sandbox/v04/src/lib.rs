mod foliage;
mod gpu;
mod height;
mod host;
mod models;
mod profiler;
mod renderer;
mod scene;
mod sky;

pub fn run() -> Result<(), Box<dyn std::error::Error>> {
    host::run()
}

#[cfg(target_arch = "wasm32")]
#[wasm_bindgen::prelude::wasm_bindgen]
pub fn start() -> Result<(), wasm_bindgen::JsValue> {
    console_error_panic_hook::set_once();
    let _ = console_log::init_with_level(log::Level::Info);
    run().map_err(|e| wasm_bindgen::JsValue::from_str(&e.to_string()))
}

#[cfg(not(target_arch = "wasm32"))]
pub fn smoke() -> Result<(), Box<dyn std::error::Error>> {
    pollster::block_on(async {
        let instance = wgpu::Instance::new(&wgpu::InstanceDescriptor {
            backends: wgpu::Backends::DX12,
            ..Default::default()
        });
        let adapter = instance
            .request_adapter(&wgpu::RequestAdapterOptions::default())
            .await?;
        let no_timestamps = std::env::args().any(|s| s == "--no-timestamps");
        let fallback = std::env::args().any(|s| s == "--workgroup");
        let requested = (if no_timestamps {
            wgpu::Features::empty()
        } else {
            wgpu::Features::TIMESTAMP_QUERY
        }) | (if fallback {
            wgpu::Features::empty()
        } else {
            wgpu::Features::SUBGROUP
        });
        let (device, queue) = adapter
            .request_device(&wgpu::DeviceDescriptor {
                required_features: adapter.features() & requested,
                ..Default::default()
            })
            .await?;
        let mut r = renderer::Renderer::new(&device);
        let mut timer = profiler::GpuProfiler::new(&device, &queue);
        let mut s = scene::Settings::default();
        let mut c = scene::Camera::default();
        c.pitch = 0.6;
        for _ in 0..48 {
            smoke_frame(&device, &queue, &mut r, &mut timer, &s, &c)?;
        }
        assert!(!r.foliage.needs_frame, "配置生成が完了する");
        for lod in 0..4 {
            s.leaf_lod = lod;
            smoke_frame(&device, &queue, &mut r, &mut timer, &s, &c)?;
            let counts = r.foliage.visible_counts;
            assert_eq!(
                counts[..3].iter().sum::<u32>() * 24,
                counts[3..].iter().sum()
            );
            for l in 0..4 {
                if l != lod as usize {
                    assert_eq!(counts[3 + l], 0);
                }
            }
        }
        s.trees = false;
        smoke_frame(&device, &queue, &mut r, &mut timer, &s, &c)?;
        assert_eq!(r.foliage.visible_counts, [0; 7]);
        s.trees = true;
        s.leaf_lod = 0;
        c.position = glam::Vec3::new(0., 6., 18.);
        c.pitch = 0.;
        r.configure_model(&device, Some(&models::ModelSettings::default()));
        smoke_frame(&device, &queue, &mut r, &mut timer, &s, &c)?;
        assert_eq!(r.foliage.visible_counts.iter().take(3).sum::<u32>(), 1);
        assert_eq!(r.foliage.visible_counts[3], 24);
        r.cluster_mode = 2;
        r.configure_model(&device, Some(&models::ModelSettings::default()));
        c.position = glam::Vec3::new(0., 1., 15.);
        smoke_frame(&device, &queue, &mut r, &mut timer, &s, &c)?;
        assert_eq!(&r.foliage.visible_counts[3..], &[1, 1, 1, 1]);
        for debug in 0..3 {
            s.debug = debug;
            s.shadow_debug = true;
            s.sky_debug = true;
            s.specular_debug = true;
            smoke_frame(&device, &queue, &mut r, &mut timer, &s, &c)?;
        }
        if timer.supported() {
            assert!(
                timer
                    .milliseconds
                    .is_some_and(|ms| ms.is_finite() && ms >= 0.)
            );
        } else {
            assert!(timer.milliseconds.is_none());
        }
        println!(
            "PASS: DX12 / 配置完了・4LOD・OFF・Modeler・LOD比較・画像デバッグ / {:?} / GPU Frame {:?} ms",
            device.features(),
            timer.milliseconds
        );
        Ok(())
    })
}
#[cfg(not(target_arch = "wasm32"))]
fn smoke_frame(
    d: &wgpu::Device,
    q: &wgpu::Queue,
    r: &mut renderer::Renderer,
    t: &mut profiler::GpuProfiler,
    s: &scene::Settings,
    c: &scene::Camera,
) -> Result<(), wgpu::PollError> {
    let mut e = d.create_command_encoder(&Default::default());
    t.begin(r.frame + 1, true);
    r.encode(q, &mut e, s, c, t);
    {
        let view = r.output.create_view(&Default::default());
        let _p = e.begin_render_pass(&wgpu::RenderPassDescriptor {
            label: Some("計測終端検証"),
            color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                view: &view,
                depth_slice: None,
                resolve_target: None,
                ops: wgpu::Operations {
                    load: wgpu::LoadOp::Load,
                    store: wgpu::StoreOp::Store,
                },
            })],
            depth_stencil_attachment: None,
            timestamp_writes: t.render_writes("検証終端"),
            occlusion_query_set: None,
        });
    }
    t.resolve(&mut e);
    q.submit([e.finish()]);
    t.submitted(|| {});
    r.foliage.submitted(|| {});
    // 無人検証に限って完了を待つ。対話描画では同期waitを使わない。
    d.poll(wgpu::PollType::wait_indefinitely())?;
    t.collect();
    r.foliage.collect();
    Ok(())
}
