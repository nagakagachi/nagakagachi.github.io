use crate::gpu::buffer;
use std::sync::{Arc, Mutex};

const SLOTS: usize = 4;
const SCOPES: usize = 16;
const QUERIES: u32 = (SCOPES * 2) as u32;
struct Slot {
    readback: wgpu::Buffer,
    pending: bool,
    result: Arc<Mutex<Option<Result<(), wgpu::BufferAsyncError>>>>,
    names: Vec<&'static str>,
    frame: u64,
    epoch: u64,
}

// クエリと読戻しをリング化し、ビジー時は計測だけを省略する。描画を同期waitさせない。
pub struct GpuProfiler {
    queries: Option<wgpu::QuerySet>,
    resolve: wgpu::Buffer,
    slots: Vec<Slot>,
    active: Option<usize>,
    period: f64,
    pub milliseconds: Option<f64>,
    pub passes: Vec<(&'static str, f64)>,
    pub frame: u64,
    pub errors: u64,
    pub history: std::collections::BTreeMap<&'static str, Window>,
    epoch: u64,
    warmup: u32,
    pub skipped: u64,
}
impl GpuProfiler {
    pub fn new(device: &wgpu::Device, queue: &wgpu::Queue) -> Self {
        let supported = device.features().contains(wgpu::Features::TIMESTAMP_QUERY);
        let queries = supported.then(|| {
            device.create_query_set(&wgpu::QuerySetDescriptor {
                label: Some("GPU計測リング"),
                ty: wgpu::QueryType::Timestamp,
                count: QUERIES * SLOTS as u32,
            })
        });
        Self {
            queries,
            resolve: buffer(
                device,
                "タイムスタンプ解決",
                256 * SLOTS as u64,
                wgpu::BufferUsages::QUERY_RESOLVE | wgpu::BufferUsages::COPY_SRC,
            ),
            slots: (0..SLOTS)
                .map(|_| Slot {
                    readback: buffer(
                        device,
                        "非同期GPU時間",
                        256,
                        wgpu::BufferUsages::COPY_DST | wgpu::BufferUsages::MAP_READ,
                    ),
                    pending: false,
                    result: Arc::new(Mutex::new(None)),
                    names: Vec::new(),
                    frame: 0,
                    epoch: 0,
                })
                .collect(),
            active: None,
            period: queue.get_timestamp_period() as f64,
            milliseconds: None,
            passes: Vec::new(),
            frame: 0,
            errors: 0,
            history: Default::default(),
            epoch: 0,
            warmup: 30,
            skipped: 0,
        }
    }
    pub fn supported(&self) -> bool {
        self.queries.is_some()
    }
    pub fn begin(&mut self, frame: u64, enabled: bool) {
        self.active = if enabled && self.supported() {
            self.slots.iter().position(|s| !s.pending)
        } else {
            None
        };
        if enabled && self.supported() && self.active.is_none() {
            self.skipped += 1;
        }
        if let Some(i) = self.active {
            self.slots[i].epoch = self.epoch;
            self.slots[i].names.clear();
            self.slots[i].frame = frame;
        }
    }
    // 各パスの先頭/末尾へ書き、先頭パスから最後のeguiパスまでをFrame時間とする。
    pub fn compute_writes(
        &mut self,
        name: &'static str,
    ) -> Option<wgpu::ComputePassTimestampWrites<'_>> {
        let (q, first) = self.reserve(name)?;
        Some(wgpu::ComputePassTimestampWrites {
            query_set: q,
            beginning_of_pass_write_index: Some(first),
            end_of_pass_write_index: Some(first + 1),
        })
    }
    pub fn render_writes(
        &mut self,
        name: &'static str,
    ) -> Option<wgpu::RenderPassTimestampWrites<'_>> {
        let (q, first) = self.reserve(name)?;
        Some(wgpu::RenderPassTimestampWrites {
            query_set: q,
            beginning_of_pass_write_index: Some(first),
            end_of_pass_write_index: Some(first + 1),
        })
    }
    fn reserve(&mut self, name: &'static str) -> Option<(&wgpu::QuerySet, u32)> {
        let i = self.active?;
        let slot = &mut self.slots[i];
        if slot.names.len() == SCOPES {
            return None;
        }
        let first = i as u32 * QUERIES + slot.names.len() as u32 * 2;
        slot.names.push(name);
        Some((self.queries.as_ref()?, first))
    }
    pub fn resolve(&self, encoder: &mut wgpu::CommandEncoder) {
        if let Some(i) = self.active {
            let count = self.slots[i].names.len() as u32 * 2;
            if count > 0 {
                encoder.resolve_query_set(
                    self.queries.as_ref().expect("計測対応時のみ"),
                    i as u32 * QUERIES..i as u32 * QUERIES + count,
                    &self.resolve,
                    i as u64 * 256,
                );
                encoder.copy_buffer_to_buffer(
                    &self.resolve,
                    i as u64 * 256,
                    &self.slots[i].readback,
                    0,
                    count as u64 * 8,
                );
            }
        }
    }
    pub fn submitted(&mut self, wake: impl Fn() + Send + Sync + 'static) {
        if let Some(i) = self.active.take() {
            let slot = &mut self.slots[i];
            if slot.names.is_empty() {
                return;
            }
            slot.pending = true;
            let result = slot.result.clone();
            slot.readback
                .slice(..)
                .map_async(wgpu::MapMode::Read, move |r| {
                    *result.lock().expect("計測結果ロック") = Some(r);
                    wake();
                });
        }
    }
    pub fn collect(&mut self) {
        for slot in &mut self.slots {
            let result = slot.result.lock().expect("計測結果ロック").take();
            if let Some(result) = result {
                if result.is_ok() {
                    let data = slot.readback.slice(..).get_mapped_range();
                    let values: &[u64] = bytemuck::cast_slice(&data);
                    if slot.epoch == self.epoch
                        && slot.frame >= self.frame
                        && !slot.names.is_empty()
                    {
                        let last = slot.names.len() * 2 - 1;
                        if values[last] >= values[0] {
                            let ms = (values[last] - values[0]) as f64 * self.period / 1e6;
                            if ms.is_finite() {
                                self.milliseconds =
                                    Some(self.milliseconds.map_or(ms, |v| v * 0.8 + ms * 0.2));
                                self.frame = slot.frame;
                                self.passes = slot
                                    .names
                                    .iter()
                                    .enumerate()
                                    .map(|(i, n)| {
                                        (
                                            *n,
                                            values[i * 2 + 1].saturating_sub(values[i * 2]) as f64
                                                * self.period
                                                / 1e6,
                                        )
                                    })
                                    .collect();
                                if self.warmup > 0 {
                                    self.warmup -= 1;
                                } else {
                                    self.history.entry("GPU Frame").or_default().push(ms);
                                    for (name, time) in &self.passes {
                                        self.history.entry(*name).or_default().push(*time);
                                    }
                                }
                            }
                        }
                    }
                    drop(data);
                    slot.readback.unmap();
                } else {
                    self.errors += 1;
                }
                slot.pending = false;
            }
        }
    }
    // 既に送信した読戻しは待たずに捨てる。新しい条件へ旧サンプルを混ぜない。
    pub fn reset(&mut self) {
        self.epoch += 1;
        self.history.clear();
        self.passes.clear();
        self.milliseconds = None;
        self.warmup = 30;
        self.skipped = 0;
    }
    pub fn warmup_remaining(&self) -> u32 {
        self.warmup
    }
    #[cfg(not(target_arch = "wasm32"))]
    pub fn pending(&self) -> bool {
        self.slots.iter().any(|s| s.pending)
    }
}

// 共通のローリング統計。P95はnearest-rank、中央値は偶数個なら中央2値の平均。
#[derive(Default)]
pub struct Window {
    values: std::collections::VecDeque<f64>,
}
impl Window {
    fn push(&mut self, v: f64) {
        if !v.is_finite() || v < 0. {
            return;
        }
        if self.values.len() == 240 {
            self.values.pop_front();
        }
        self.values.push_back(v);
    }
    pub fn summary(&self) -> Option<(usize, f64, f64, f64)> {
        let mut values = self.values.iter().copied().collect::<Vec<_>>();
        if values.is_empty() {
            return None;
        }
        values.sort_by(f64::total_cmp);
        let n = values.len();
        let median = (values[(n - 1) / 2] + values[n / 2]) * 0.5;
        Some((
            n,
            *self.values.back().unwrap(),
            median,
            values[(n * 95).div_ceil(100) - 1],
        ))
    }
}
#[cfg(test)]
mod statistics_tests {
    use super::*;
    #[test]
    fn rolling_percentiles_and_invalid_values() {
        let mut w = Window::default();
        for n in 1..=100 {
            w.push(n as f64);
        }
        w.push(f64::NAN);
        assert_eq!(w.summary(), Some((100, 100., 50.5, 95.)));
        for _ in 0..300 {
            w.push(1.);
        }
        assert_eq!(w.summary(), Some((240, 1., 1., 1.)));
    }
}
