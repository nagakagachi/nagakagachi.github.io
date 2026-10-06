// Test01 owns its initialization, resources and animation loop.
const start = document.querySelector('#gpu-start');
const stop = document.querySelector('#gpu-stop');
const slider = document.querySelector('#gpu-angle');
const angleValue = document.querySelector('#gpu-angle-value');
const status = document.querySelector('#gpu-status');
const canvas = document.querySelector('#gpu-canvas');
const info = document.querySelector('#gpu-info');
const uniformData = new Float32Array(4); // vec4f: angle, aspect ratio, 0, 0.
let device, context, uniformBuffer, pipeline, bindGroup;
let angle = 0;
let running = false;
let initializing = false;
let frameId = 0;
let lastTime = null;
let generation = 0;

function updateAngleDisplay() {
  slider.value = String(Math.round(angle));
  angleValue.value = `${Math.round(angle)}°`;
}
function pause() {
  running = false;
  cancelAnimationFrame(frameId);
  frameId = 0;
  lastTime = null;
  start.disabled = initializing;
  stop.disabled = true;
}
function release() {
  pause();
  context?.unconfigure();
  uniformBuffer?.destroy();
  device?.destroy();
  device = context = uniformBuffer = pipeline = bindGroup = undefined;
  slider.disabled = true;
}
function fail(message) {
  generation++;
  initializing = false;
  release();
  start.disabled = false;
  start.textContent = '開始';
  status.textContent = `実行できませんでした: ${message}`;
}
function detail(label, value) {
  const dt = document.createElement('dt');
  const dd = document.createElement('dd');
  dt.textContent = label;
  dd.textContent = value;
  info.append(dt, dd);
}
function draw() {
  uniformData[0] = angle * Math.PI / 180;
  uniformData[1] = canvas.width / canvas.height;
  device.queue.writeBuffer(uniformBuffer, 0, uniformData);
  const encoder = device.createCommandEncoder();
  const pass = encoder.beginRenderPass({ colorAttachments: [{
    view: context.getCurrentTexture().createView(),
    clearValue: { r: 0.09, g: 0.12, b: 0.14, a: 1 },
    loadOp: 'clear', storeOp: 'store',
  }] });
  pass.setPipeline(pipeline);
  pass.setBindGroup(0, bindGroup);
  pass.draw(3);
  pass.end();
  device.queue.submit([encoder.finish()]);
}
function frame(time) {
  if (!running) return;
  try {
    if (lastTime !== null) angle = (angle + (time - lastTime) * 0.045) % 360;
    lastTime = time;
    updateAngleDisplay();
    draw();
    frameId = requestAnimationFrame(frame);
  } catch (error) { fail(error.message); }
}
async function initialize() {
  const token = ++generation;
  if (!window.isSecureContext) throw new Error('HTTPSまたはlocalhostで開いてください');
  if (!navigator.gpu) throw new Error('このブラウザ環境ではWebGPUを利用できません');
  const adapter = await navigator.gpu.requestAdapter();
  if (token !== generation) return false;
  if (!adapter) throw new Error('利用可能なGPUアダプターを取得できませんでした');
  const currentDevice = await adapter.requestDevice();
  if (token !== generation) { currentDevice.destroy(); return false; }
  device = currentDevice;
  device.lost.then(({ reason, message }) => {
    if (device === currentDevice && reason !== 'destroyed') fail(`GPUデバイスを失いました: ${message || reason}`);
  });
  device.addEventListener('uncapturederror', event => {
    if (device === currentDevice) fail(event.error.message);
  });
  context = canvas.getContext('webgpu');
  if (!context) throw new Error('WebGPUのCanvasを取得できませんでした');
  const format = navigator.gpu.getPreferredCanvasFormat();
  context.configure({ device, format, alphaMode: 'opaque' });
  const response = await fetch(new URL('./triangle.wgsl', import.meta.url));
  if (token !== generation) return false;
  if (!response.ok) throw new Error(`WGSLの取得に失敗しました: ${response.status}`);
  const code = await response.text();
  if (token !== generation) return false;
  const shader = device.createShaderModule({ code });
  const compilation = await shader.getCompilationInfo();
  if (token !== generation) return false;
  const errors = compilation.messages.filter(message => message.type === 'error');
  if (errors.length) throw new Error(errors.map(message => message.message).join('; '));
  device.pushErrorScope('validation');
  uniformBuffer = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const bindGroupLayout = device.createBindGroupLayout({ entries: [{
    binding: 0, visibility: GPUShaderStage.VERTEX,
    buffer: { type: 'uniform', minBindingSize: 16 },
  }] });
  bindGroup = device.createBindGroup({ layout: bindGroupLayout, entries: [{
    binding: 0, resource: { buffer: uniformBuffer, offset: 0, size: 16 },
  }] });
  pipeline = await device.createRenderPipelineAsync({
    layout: device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] }),
    vertex: { module: shader, entryPoint: 'vertexMain' },
    fragment: { module: shader, entryPoint: 'fragmentMain', targets: [{ format }] },
    primitive: { topology: 'triangle-list' },
  });
  if (token !== generation) return false;
  draw();
  const validation = await device.popErrorScope();
  if (token !== generation) return false;
  if (validation) throw new Error(validation.message);
  await device.queue.onSubmittedWorkDone();
  if (token !== generation) return false;
  info.replaceChildren();
  detail('GPU情報', adapter.info?.description || '機種名を取得できませんでした');
  detail('Uniform Buffer', '16バイト · group 0 / binding 0 · 頂点ステージ');
  detail('描画サイズ', `${canvas.width} × ${canvas.height}`);
  slider.disabled = false;
  return true;
}
start.addEventListener('click', async () => {
  if (running || initializing) return;
  const attempt = generation;
  initializing = true;
  start.disabled = true;
  try {
    if (!device) {
      status.textContent = 'WebGPUを初期化しています';
      if (!await initialize()) return;
    }
    initializing = false;
    running = true;
    stop.disabled = false;
    start.textContent = '再開';
    status.textContent = '回転中';
    frameId = requestAnimationFrame(frame);
  } catch (error) {
    // Ignore failures from an initialization abandoned by pagehide or fail().
    if (generation <= attempt + 1) fail(error.message);
  } finally {
    initializing = false;
    if (!running) start.disabled = false;
  }
});
stop.addEventListener('click', () => { pause(); status.textContent = '停止中'; });
slider.addEventListener('input', () => {
  angle = Number(slider.value);
  updateAngleDisplay();
  if (device) {
    try { draw(); } catch (error) { fail(error.message); }
    if (!running && device) status.textContent = '停止中 · 角度を更新しました';
  }
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden && running) { pause(); status.textContent = '停止中 · ページが非表示になりました'; }
});
window.addEventListener('pagehide', () => {
  generation++;
  initializing = false;
  release();
  start.disabled = false;
  start.textContent = '開始';
  status.textContent = '開始ボタンで再初期化します';
});
