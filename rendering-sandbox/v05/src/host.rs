mod inspector;
mod resolution;
use crate::{
    profiler::GpuProfiler,
    renderer::Renderer,
    scene::{Camera, Settings},
};
use std::sync::Arc;
use winit::{
    application::ApplicationHandler,
    event::{ElementState, WindowEvent},
    event_loop::{ActiveEventLoop, EventLoop, EventLoopProxy},
    window::{Window, WindowId},
};

#[derive(Debug)]
enum Event {
    Ready,
    Wake,
    #[cfg(not(target_arch = "wasm32"))]
    RepaintAfter(std::time::Duration),
    Metrics,
    Failure(String),
}
struct App {
    state: Option<State>,
    #[cfg(not(target_arch = "wasm32"))]
    repaint_at: Option<std::time::Instant>,
    proxy: EventLoopProxy<Event>,
    error: Option<String>,
    pending: std::rc::Rc<std::cell::RefCell<Option<State>>>,
}
#[derive(Clone)]
struct Snapshot {
    settings: Settings,
    camera: Camera,
    resolution: resolution::Resolution,
}
struct State {
    window: Arc<Window>,
    surface: wgpu::Surface<'static>,
    device: wgpu::Device,
    queue: wgpu::Queue,
    config: wgpu::SurfaceConfiguration,
    ctx: egui::Context,
    input: egui_winit::State,
    gui: egui_wgpu::Renderer,
    renderer: Renderer,
    profiler: GpuProfiler,
    image: egui::TextureId,
    settings: Settings,
    camera: Camera,
    modeler: bool,
    model: crate::models::ModelSettings,
    measure: bool,
    metrics_only: bool,
    continuous: bool,
    resolution: resolution::Resolution,
    occluded: bool,
    adapter: String,
    comparisons: [Option<Snapshot>; 2],
    camera_locked: bool,
    generation_busy: bool,
    measurement_key: Option<(Settings, [u32; 2], bool)>,
}
impl std::fmt::Debug for State {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("Sandbox State")
    }
}
impl App {
    fn fail(&mut self, message: String) {
        log::error!("{message}");
        self.error = Some(message.clone());
        #[cfg(target_arch = "wasm32")]
        if let Some(document) = web_sys::window().and_then(|w| w.document()) {
            if let Some(status) = document.get_element_by_id("rust-status") {
                status.set_text_content(Some(&message));
            }
        }
    }
}
impl ApplicationHandler<Event> for App {
    fn resumed(&mut self, event_loop: &ActiveEventLoop) {
        if self.state.is_some() {
            return;
        }
        let attributes =
            Window::default_attributes().with_title("RenderingSandbox v05 — Rust / wgpu");
        #[cfg(not(target_arch = "wasm32"))]
        let attributes = attributes.with_inner_size(winit::dpi::LogicalSize::new(1200., 760.));
        #[cfg(target_arch = "wasm32")]
        let attributes = {
            use wasm_bindgen::JsCast;
            use winit::platform::web::WindowAttributesExtWebSys;
            let document = web_sys::window()
                .expect("ブラウザWindow")
                .document()
                .expect("Document");
            let canvas = document
                .get_element_by_id("rust-canvas")
                .expect("rust-canvas")
                .dyn_into::<web_sys::HtmlCanvasElement>()
                .expect("Canvas");
            // Webではinner_sizeを指定しない。winitが固定pxのCSSを書き込み、
            // ページ幅に追従するwidth/heightを上書きしてしまうため。
            // CSSのサイズ変更はwinit内蔵ResizeObserverがResizedへ伝える。
            attributes
                .with_canvas(Some(canvas))
                .with_prevent_default(true)
        };
        let window = match event_loop.create_window(attributes) {
            Ok(w) => Arc::new(w),
            Err(e) => {
                self.fail(e.to_string());
                return;
            }
        };
        let proxy = self.proxy.clone();
        let pending = self.pending.clone();
        let task = async move {
            match State::new(window, proxy.clone()).await {
                Ok(s) => {
                    *pending.borrow_mut() = Some(s);
                    let _ = proxy.send_event(Event::Ready);
                }
                Err(e) => {
                    let _ = proxy.send_event(Event::Failure(e));
                }
            }
        };
        #[cfg(target_arch = "wasm32")]
        wasm_bindgen_futures::spawn_local(task);
        #[cfg(not(target_arch = "wasm32"))]
        pollster::block_on(task);
    }
    fn user_event(&mut self, event_loop: &ActiveEventLoop, event: Event) {
        match event {
            Event::Ready => {
                if let Some(state) = self.pending.borrow_mut().take() {
                    state.window.request_redraw();
                    self.state = Some(state);
                }
                #[cfg(target_arch = "wasm32")]
                if let Some(el) = web_sys::window()
                    .and_then(|w| w.document())
                    .and_then(|d| d.get_element_by_id("rust-status"))
                {
                    el.set_text_content(Some("起動済み — 操作・設定はビュー内のeguiにあります"));
                }
            }
            Event::Metrics => {
                if let Some(s) = &mut self.state {
                    s.profiler.collect();
                    s.renderer.foliage.collect();
                    s.renderer.screen.collect();
                    s.metrics_only &= !s.renderer.foliage.needs_frame;
                    s.window.request_redraw();
                }
            }
            #[cfg(not(target_arch = "wasm32"))]
            Event::RepaintAfter(delay) => {
                let at = std::time::Instant::now() + delay;
                self.repaint_at = Some(self.repaint_at.map_or(at, |old| old.min(at)));
            }
            Event::Wake => {
                if let Some(s) = &self.state {
                    s.window.request_redraw();
                }
            }
            Event::Failure(e) => {
                self.fail(e);
                event_loop.exit();
            }
        }
    }
    fn window_event(&mut self, event_loop: &ActiveEventLoop, _id: WindowId, event: WindowEvent) {
        let Some(s) = &mut self.state else {
            return;
        };
        let response = s.input.on_window_event(&s.window, &event);
        if response.repaint && !matches!(event, WindowEvent::RedrawRequested) {
            s.metrics_only = false;
            s.window.request_redraw();
        }
        match event {
            WindowEvent::CloseRequested => event_loop.exit(),
            WindowEvent::Resized(size) => {
                if size.width > 0 && size.height > 0 {
                    s.config.width = size.width;
                    s.config.height = size.height;
                    s.surface.configure(&s.device, &s.config);
                    s.window.request_redraw();
                }
            }
            WindowEvent::Occluded(hidden) => {
                s.occluded = hidden;
                if !hidden {
                    s.window.request_redraw();
                }
            }
            WindowEvent::RedrawRequested => {
                if s.occluded {
                    return;
                }
                #[cfg(target_arch = "wasm32")]
                if web_sys::window()
                    .and_then(|w| w.document())
                    .is_some_and(|d| d.hidden())
                {
                    return;
                }
                if let Err(e) = s.draw(&self.proxy) {
                    self.fail(e);
                }
            }
            WindowEvent::KeyboardInput { event, .. } => {
                if event.state == ElementState::Pressed {
                    s.metrics_only = false;
                    s.window.request_redraw();
                }
            }
            _ => {}
        }
    }
    fn about_to_wait(&mut self, event_loop: &ActiveEventLoop) {
        #[cfg(not(target_arch = "wasm32"))]
        if let Some(s) = &self.state {
            let _ = s.device.poll(wgpu::PollType::Poll);
            let now = std::time::Instant::now();
            if self.repaint_at.is_some_and(|t| t <= now) {
                self.repaint_at = None;
                s.window.request_redraw();
            }
            let gpu = (s.profiler.pending()
                || s.renderer.foliage.pending()
                || s.renderer.screen.pending())
            .then_some(now + std::time::Duration::from_millis(8));
            let deadline = match (gpu, self.repaint_at) {
                (Some(a), Some(b)) => Some(a.min(b)),
                (a, b) => a.or(b),
            };
            event_loop.set_control_flow(deadline.map_or(
                winit::event_loop::ControlFlow::Wait,
                winit::event_loop::ControlFlow::WaitUntil,
            ));
        }
        #[cfg(target_arch = "wasm32")]
        let _ = event_loop;
    }
}
impl State {
    async fn new(window: Arc<Window>, proxy: EventLoopProxy<Event>) -> Result<Self, String> {
        let backends = if cfg!(target_arch = "wasm32") {
            wgpu::Backends::BROWSER_WEBGPU
        } else {
            wgpu::Backends::DX12
        };
        let instance = wgpu::Instance::new(&wgpu::InstanceDescriptor {
            backends,
            ..Default::default()
        });
        let surface = instance
            .create_surface(window.clone())
            .map_err(|e| e.to_string())?;
        let adapter = instance
            .request_adapter(&wgpu::RequestAdapterOptions {
                compatible_surface: Some(&surface),
                power_preference: wgpu::PowerPreference::HighPerformance,
                force_fallback_adapter: false,
            })
            .await
            .map_err(|e| e.to_string())?;
        let features =
            adapter.features() & (wgpu::Features::TIMESTAMP_QUERY | wgpu::Features::SUBGROUP);
        let (device, queue) = adapter
            .request_device(&wgpu::DeviceDescriptor {
                label: Some("Sandbox共通GPU"),
                required_features: features,
                required_limits: wgpu::Limits::default(),
                ..Default::default()
            })
            .await
            .map_err(|e| e.to_string())?;
        let error_proxy = proxy.clone();
        device.on_uncaptured_error(Arc::new(move |e: wgpu::Error| {
            let _ = error_proxy.send_event(Event::Failure(e.to_string()));
        }));
        let caps = surface.get_capabilities(&adapter);
        let format = caps
            .formats
            .iter()
            .copied()
            .find(|f| !f.is_srgb())
            .ok_or("非sRGB Surface形式がありません")?;
        let size = window.inner_size();
        let config = wgpu::SurfaceConfiguration {
            usage: wgpu::TextureUsages::RENDER_ATTACHMENT,
            format,
            width: size.width.max(1),
            height: size.height.max(1),
            present_mode: wgpu::PresentMode::Fifo,
            desired_maximum_frame_latency: 2,
            alpha_mode: caps.alpha_modes[0],
            view_formats: vec![],
        };
        surface.configure(&device, &config);
        let ctx = egui::Context::default();
        ctx.set_visuals(egui::Visuals::dark());
        let mut fonts = egui::FontDefinitions::default();
        fonts.font_data.insert(
            "日本語".into(),
            Arc::new(egui::FontData::from_static(include_bytes!(
                "../assets/NotoSansJP-UI.ttf"
            ))),
        );
        fonts
            .families
            .entry(egui::FontFamily::Proportional)
            .or_default()
            .push("日本語".into());
        ctx.set_fonts(fonts);
        let wake = proxy.clone();
        ctx.set_request_repaint_callback(move |info| {
            schedule_repaint(wake.clone(), info.delay);
        });
        let input = egui_winit::State::new(
            ctx.clone(),
            egui::ViewportId::ROOT,
            window.as_ref(),
            Some(window.scale_factor() as f32),
            window.theme(),
            None,
        );
        let mut gui =
            egui_wgpu::Renderer::new(&device, format, egui_wgpu::RendererOptions::default());
        let renderer = Renderer::new(&device);
        let image = gui.register_native_texture(
            &device,
            &renderer.output.create_view(&Default::default()),
            wgpu::FilterMode::Linear,
        );
        let profiler = GpuProfiler::new(&device, &queue);
        let adapter = format!(
            "{} / {:?}",
            adapter.get_info().name,
            adapter.get_info().backend
        );
        Ok(Self {
            window,
            surface,
            device,
            queue,
            config,
            ctx,
            input,
            gui,
            renderer,
            profiler,
            image,
            settings: Settings::default(),
            camera: Camera::default(),
            modeler: false,
            model: crate::models::ModelSettings::default(),
            measure: true,
            metrics_only: false,
            continuous: true,
            resolution: resolution::Resolution::Auto,
            occluded: false,
            adapter,
            comparisons: [None, None],
            camera_locked: false,
            generation_busy: true,
            measurement_key: None,
        })
    }
    fn draw(&mut self, proxy: &EventLoopProxy<Event>) -> Result<(), String> {
        self.profiler.collect();
        self.renderer.screen.collect();
        let raw = self.input.take_egui_input(&self.window);
        let mut pixels = [1, 1];
        let mut moving = false;
        let mut hovered = false;
        let mut drag = egui::Vec2::ZERO;
        let ctx = self.ctx.clone();
        let output = ctx.run(raw, |ctx| {
            egui::SidePanel::right("inspector")
                .default_width(290.)
                .resizable(true)
                .show(ctx, |ui| {
                    egui::ScrollArea::vertical().show(ui, |ui| {
                        self.inspector(ui);
                    });
                });
            egui::CentralPanel::default().show(ctx, |ui| {
                ui.label("WASD：移動　Q/E：上下　Shift：加速　ドラッグ：回転");
                // パネルを除いた領域に16:9のビューを収め、余白では引き伸ばさない。
                let available = ui.available_size();
                let width = available.x.min(available.y * 16. / 9.).max(1.);
                let size = egui::vec2(width, width * 9. / 16.);
                pixels = self.resolution.pixels(
                    size.x * ctx.pixels_per_point(),
                    self.device.limits().max_texture_dimension_2d,
                );
                let offset = (available - size) * 0.5;
                let rect = egui::Rect::from_min_size(ui.cursor().min + offset, size);
                let response = ui.put(
                    rect,
                    egui::Image::new((self.image, size)).sense(egui::Sense::click_and_drag()),
                );
                hovered = response.hovered();
                drag = if response.dragged() {
                    response.drag_delta()
                } else {
                    egui::Vec2::ZERO
                };
            });
        });
        // UIの複数レイアウトパスで移動を重複適用しない。入力を確定後に1回だけ反映する。
        if !self.camera_locked && drag.length_sq() > 0. {
            self.camera.yaw -= drag.x * 0.004;
            self.camera.pitch = (self.camera.pitch + drag.y * 0.004).clamp(-1.54, 1.54);
            moving = true;
        }
        if !self.camera_locked && hovered && !self.ctx.wants_keyboard_input() {
            self.ctx.input(|i| {
                let axis = |a, b| i.key_down(a) as u32 as f32 - i.key_down(b) as u32 as f32;
                let dt = i.stable_dt.min(0.05);
                let delta = self.camera.forward() * axis(egui::Key::W, egui::Key::S)
                    + glam::Vec3::new(self.camera.yaw.cos(), 0., -self.camera.yaw.sin())
                        * axis(egui::Key::D, egui::Key::A)
                    + glam::Vec3::Y * axis(egui::Key::E, egui::Key::Q);
                if delta.length_squared() > 0. {
                    self.camera.position += delta.normalize()
                        * self.camera.speed
                        * dt
                        * if i.modifiers.shift { 4. } else { 1. };
                    moving = true;
                }
                let yaw = axis(egui::Key::ArrowLeft, egui::Key::ArrowRight);
                let pitch = axis(egui::Key::ArrowDown, egui::Key::ArrowUp);
                if yaw != 0. || pitch != 0. {
                    self.camera.yaw += yaw * dt;
                    self.camera.pitch = (self.camera.pitch + pitch * dt).clamp(-1.54, 1.54);
                    moving = true;
                }
                if i.smooth_scroll_delta.y.abs() > 0.01 {
                    self.camera.position += self.camera.forward() * i.smooth_scroll_delta.y * 0.2;
                    moving = true;
                }
            });
        }
        self.input
            .handle_platform_output(&self.window, output.platform_output);
        if self.camera_locked {
            self.settings.animate = false;
        }
        if self.settings.animate {
            self.settings.azimuth =
                (self.settings.azimuth + self.ctx.input(|i| i.stable_dt.min(0.05)) * 3.0) % 360.;
            moving = true;
        }
        if self.renderer.resize(&self.device, pixels) {
            self.gui.update_egui_texture_from_wgpu_texture(
                &self.device,
                &self.renderer.output.create_view(&Default::default()),
                wgpu::FilterMode::Linear,
                self.image,
            );
        }
        self.renderer.prepare_screen(&self.device, &self.settings);
        let frame = match self.surface.get_current_texture() {
            Ok(f) => f,
            Err(wgpu::SurfaceError::Lost | wgpu::SurfaceError::Outdated) => {
                self.surface.configure(&self.device, &self.config);
                self.window.request_redraw();
                return Ok(());
            }
            Err(wgpu::SurfaceError::Timeout) => return Ok(()),
            Err(e) => return Err(e.to_string()),
        };
        let mut encoder = self
            .device
            .create_command_encoder(&wgpu::CommandEncoderDescriptor {
                label: Some("Sandbox Frame"),
            });
        self.renderer.configure_model(
            &self.device,
            if self.modeler {
                Some(&self.model)
            } else {
                None
            },
        );
        let key = (self.settings.clone(), self.renderer.size, self.modeler);
        let generation_busy = self.renderer.foliage.needs_frame;
        if self.generation_busy && !generation_busy {
            self.profiler.reset();
        }
        self.generation_busy = generation_busy;
        if self.measurement_key.as_ref() != Some(&key) {
            self.profiler.reset();
            self.measurement_key = Some(key);
        }
        let active_frame = !self.metrics_only
            || moving
            || self.continuous
            || self.settings.animate
            || self.renderer.foliage.needs_frame;
        self.renderer.refresh_statistics = active_frame;
        self.profiler
            .begin(self.renderer.frame + 1, self.measure && active_frame);
        self.metrics_only = true;
        self.renderer.encode(
            &self.queue,
            &mut encoder,
            &self.settings,
            &self.camera,
            &mut self.profiler,
        );
        let paint = self.ctx.tessellate(output.shapes, output.pixels_per_point);
        let screen = egui_wgpu::ScreenDescriptor {
            size_in_pixels: [self.config.width, self.config.height],
            pixels_per_point: output.pixels_per_point,
        };
        for (id, delta) in &output.textures_delta.set {
            self.gui
                .update_texture(&self.device, &self.queue, *id, delta);
        }
        let commands =
            self.gui
                .update_buffers(&self.device, &self.queue, &mut encoder, &paint, &screen);
        let view = frame.texture.create_view(&Default::default());
        {
            let pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: Some("egui合成"),
                color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                    view: &view,
                    depth_slice: None,
                    resolve_target: None,
                    ops: wgpu::Operations {
                        load: wgpu::LoadOp::Clear(wgpu::Color {
                            r: 0.025,
                            g: 0.035,
                            b: 0.04,
                            a: 1.,
                        }),
                        store: wgpu::StoreOp::Store,
                    },
                })],
                depth_stencil_attachment: None,
                timestamp_writes: self.profiler.render_writes("egui"),
                occlusion_query_set: None,
            });
            self.gui
                .render(&mut pass.forget_lifetime(), &paint, &screen);
        }
        self.profiler.resolve(&mut encoder);
        self.queue.submit(
            commands
                .into_iter()
                .chain(std::iter::once(encoder.finish())),
        );
        let wake = proxy.clone();
        self.profiler.submitted(move || {
            let _ = wake.send_event(Event::Metrics);
        });
        let foliage_wake = proxy.clone();
        self.renderer.foliage.submitted(move || {
            let _ = foliage_wake.send_event(Event::Metrics);
        });
        let screen_wake = proxy.clone();
        self.renderer.screen.submitted(move || {
            let _ = screen_wake.send_event(Event::Metrics);
        });
        frame.present();
        for id in &output.textures_delta.free {
            self.gui.free_texture(id);
        }
        if moving || self.continuous {
            self.window.request_redraw();
        }
        Ok(())
    }
}
pub fn run() -> Result<(), Box<dyn std::error::Error>> {
    let event_loop = EventLoop::<Event>::with_user_event().build()?;
    let app = App {
        state: None,
        proxy: event_loop.create_proxy(),
        error: None,
        pending: Default::default(),
        #[cfg(not(target_arch = "wasm32"))]
        repaint_at: None,
    };
    #[cfg(target_arch = "wasm32")]
    {
        use winit::platform::web::EventLoopExtWebSys;
        event_loop.spawn_app(app);
    }
    #[cfg(not(target_arch = "wasm32"))]
    {
        let mut app = app;
        event_loop.run_app(&mut app)?;
        if let Some(error) = app.error {
            return Err(error.into());
        }
    }
    Ok(())
}

// eguiの遅延再描画要求を即時に戻すと、静止時にもループしてしまうため期限を守る。
fn schedule_repaint(proxy: EventLoopProxy<Event>, delay: std::time::Duration) {
    if delay == std::time::Duration::MAX {
        return;
    }
    if delay.is_zero() {
        let _ = proxy.send_event(Event::Wake);
        return;
    }
    #[cfg(not(target_arch = "wasm32"))]
    {
        let _ = proxy.send_event(Event::RepaintAfter(delay));
    }
    #[cfg(target_arch = "wasm32")]
    {
        use wasm_bindgen::JsCast;
        let callback = wasm_bindgen::closure::Closure::once_into_js(move || {
            let _ = proxy.send_event(Event::Wake);
        });
        if let Some(window) = web_sys::window() {
            let _ = window.set_timeout_with_callback_and_timeout_and_arguments_0(
                callback.unchecked_ref(),
                delay.as_millis().min(i32::MAX as u128) as i32,
            );
        }
    }
}
