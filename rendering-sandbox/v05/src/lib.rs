mod foliage;
mod gpu;
mod height;
mod host;
mod models;
mod primitive;
mod profiler;
mod renderer;
mod scene;
mod sky;
mod polar_shadow;
mod volumetric_fog;

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

#[cfg(target_arch = "wasm32")]
#[wasm_bindgen::prelude::wasm_bindgen]
pub fn request_view_copy() {
    host::request_view_copy();
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
        let cache_only = std::env::args().any(|arg| arg == "--polar-only");
        let fog_only = std::env::args().any(|arg| arg == "--fog-only");
        let primitive_only = std::env::args().any(|arg| arg == "--primitive-only");
        let mut r = renderer::Renderer::new(&device);
        let mut timer = profiler::GpuProfiler::new(&device, &queue);
        let mut s = scene::Settings::default();
        let mut c = scene::Camera::default();
        c.pitch = 0.6;
        if cache_only || fog_only || primitive_only {
            use polar_shadow::Mapping;
            r.resize(&device, [640, 360]);
            s.density = 4;
            s.radius = if primitive_only { 16000.0 } else { 256.0 };
            s.primitives.enabled = primitive_only;
            s.polar.enabled = true;
            s.polar.inner_follow_csm = false;
            s.polar.inner_radius = 0.0;
            s.polar.overlay = false;
            s.fog.enabled = fog_only;
            s.csm_apply_shadow = false;
            if primitive_only {
                s.trees = false;
                c.position = glam::Vec3::new(0.0, 6000.0, 6000.0);
                let direction = (-c.position).normalize();
                c.pitch = (-direction.y).asin(); c.yaw = (-direction.x).atan2(-direction.z);
            }
            let capture = std::env::args().skip_while(|arg| arg != "--capture").nth(1);
            let preview_once = std::env::args().any(|arg| arg == "--preview-once");
            // 同じキャッシュをモード切替で再使用し、各ソースとサーフェイスを確認する。
            for (i, mode) in [Mapping::FullDisk, Mapping::ViewFitted, Mapping::FullDisk].into_iter().enumerate() {
                s.polar.mapping = mode;
                s.polar.source_csm = i != 1; s.polar.source_main_depth = i != 0;
                if preview_once {
                    s.polar.source_csm = false;
                    s.polar.source_main_depth = true;
                }
                smoke_frame(&device, &queue, &mut r, &mut timer, &s, &c)?;
                if let Some(path) = &capture {
                    capture_ppm(&device, &queue, &r, std::path::Path::new(path), &format!("psc-mode-{i}"))?;
                }
                if preview_once { println!("PASS: PSC実景プレビュー"); return Ok(()); }
            }
            s.polar.source_csm = false; s.polar.source_main_depth = false;
            smoke_frame(&device, &queue, &mut r, &mut timer, &s, &c)?;
            s.polar.source_main_depth = true;
            for (i, size) in [[256, 512], [512, 256], [1024, 1024]].into_iter().enumerate() {
                s.polar.mapping = if i == 1 { Mapping::FullDisk } else { Mapping::ViewFitted };
                s.polar.size = size; s.polar.surface_grid = true;
                s.polar.pcf = i != 1; s.polar.overlay = true; s.polar.projected = i != 0;
                s.polar.world_debug = true; s.polar.xray = i == 1; s.polar.grid = true;
                smoke_frame(&device, &queue, &mut r, &mut timer, &s, &c)?;
            }
            s.polar.surface_grid = false; s.polar.world_debug = false;
            s.fog.enabled = true;
            for mode in [Mapping::FullDisk, Mapping::ViewFitted] {
                s.polar.mapping = mode;
                smoke_frame(&device, &queue, &mut r, &mut timer, &s, &c)?;
            }
            // 履歴を保持したままカメラを動かし、中心がずれた状態のフォグも通す。
            s.polar.mapping = Mapping::FullDisk;
            s.polar.preserve_cache = true;
            smoke_frame(&device, &queue, &mut r, &mut timer, &s, &c)?;
            c.position.x += 16.0;
            smoke_frame(&device, &queue, &mut r, &mut timer, &s, &c)?;
            s.polar.caster_bias_constant = 128.0;
            s.polar.caster_bias_scale = 8.0;
            s.polar.caster_bias_limit = 2048.0;
            smoke_frame(&device, &queue, &mut r, &mut timer, &s, &c)?;
            s.polar.enabled = false;
            smoke_frame(&device, &queue, &mut r, &mut timer, &s, &c)?;
            s.fog.density = 0.0; s.fog.divisor = 8;
            r.resize(&device, [321, 181]);
            smoke_frame(&device, &queue, &mut r, &mut timer, &s, &c)?;
            s.fog.enabled = false; s.primitives.enabled = false;
            smoke_frame(&device, &queue, &mut r, &mut timer, &s, &c)?;
            println!("PASS: 統合PSCの両マッピング・各ソース・PCF・解像度・デバッグ・フォグ・無効化");
            return Ok(());
        }
        for _ in 0..48 {
            smoke_frame(&device, &queue, &mut r, &mut timer, &s, &c)?;
        }
        assert!(!r.foliage.needs_frame, "配置生成が完了する");
        if let Some(path) = std::env::args().skip_while(|s| s != "--capture").nth(1) {
            r.resize(&device, [1280, 720]);
            smoke_frame(&device, &queue, &mut r, &mut timer, &s, &c)?;
            capture_ppm(&device, &queue, &r, std::path::Path::new(&path), "combined")?;
        }

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
    r.prepare_screen(d, s);
    r.encode(q, &mut e, s, c, t, 1.0 / 60.0);
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

// 診断CLIだけで画像を読戻す。対話版の画面出力や通常フレームでは実行しない。
#[cfg(not(target_arch = "wasm32"))]
fn capture_ppm(
    d: &wgpu::Device,
    q: &wgpu::Queue,
    r: &renderer::Renderer,
    path: &std::path::Path,
    name: &str,
) -> Result<(), Box<dyn std::error::Error>> {
    let [w, h] = r.size;
    let pitch = (w * 4).div_ceil(256) * 256;
    let b = gpu::buffer(
        d,
        "画像確認用",
        pitch as u64 * h as u64,
        wgpu::BufferUsages::COPY_DST | wgpu::BufferUsages::MAP_READ,
    );
    let mut e = d.create_command_encoder(&Default::default());
    e.copy_texture_to_buffer(
        wgpu::TexelCopyTextureInfo {
            texture: &r.output,
            mip_level: 0,
            origin: wgpu::Origin3d::ZERO,
            aspect: wgpu::TextureAspect::All,
        },
        wgpu::TexelCopyBufferInfo {
            buffer: &b,
            layout: wgpu::TexelCopyBufferLayout {
                offset: 0,
                bytes_per_row: Some(pitch),
                rows_per_image: Some(h),
            },
        },
        wgpu::Extent3d {
            width: w,
            height: h,
            depth_or_array_layers: 1,
        },
    );
    q.submit([e.finish()]);
    let result = std::sync::Arc::new(std::sync::Mutex::new(None));
    let callback = result.clone();
    b.slice(..).map_async(wgpu::MapMode::Read, move |v| {
        *callback.lock().unwrap() = Some(v);
    });
    d.poll(wgpu::PollType::wait_indefinitely())?;
    result.lock().unwrap().take().expect("画像読戻し完了")?;
    let data = b.slice(..).get_mapped_range();
    let mut bytes = format!("P6\n{w} {h}\n255\n").into_bytes();
    for y in 0..h {
        for x in 0..w {
            let offset = (y * pitch + x * 4) as usize;
            bytes.extend_from_slice(&data[offset..offset + 3]);
        }
    }
    std::fs::create_dir_all(path)?;
    std::fs::write(path.join(format!("{name}.ppm")), bytes)?;
    drop(data);
    b.unmap();
    Ok(())
}
