// This Test owns its initialization, shaders and animation loop.
const button = document.querySelector('#gpu-start');
const status = document.querySelector('#gpu-status');
const canvas = document.querySelector('#gpu-canvas');
const info = document.querySelector('#gpu-info');
const stop = document.querySelector('#gpu-stop');
const clear = document.querySelector('#gpu-clear');
const speed = document.querySelector('#gpu-speed');
const halfLife = document.querySelector('#gpu-half-life');
const width = 320, height = 180;
let device, context, optionsBuffer, sceneTexture, scenePipeline, sceneGroup;
let computePipeline, presentPipeline, computeGroups, presentGroups;
let histories = [];
let generation = 0, busy = false, running = false, frame = 0;
let readIndex = 0, time = 0, lastTimestamp = null;
function detail(label, value) {
  const dt = document.createElement('dt'), dd = document.createElement('dd');
  dt.textContent = label;
  dd.textContent = value;
  info.append(dt, dd);
}
function pause() {
  running = false;
  cancelAnimationFrame(frame);
  lastTimestamp = null;
  stop.disabled = true;
  button.disabled = busy;
  button.textContent = device ? '再開' : '開始';
}
function release() {
  pause();
  context?.unconfigure();
  sceneTexture?.destroy();
  histories.forEach(texture => texture.destroy());
  optionsBuffer?.destroy();
  device?.destroy();
  device = context = optionsBuffer = sceneTexture = scenePipeline = sceneGroup = undefined;
  computePipeline = presentPipeline = computeGroups = presentGroups = undefined;
  histories = [];
}
function fail(message) {
  generation++;
  busy = false;
  release();
  button.disabled = false;
  button.textContent = '開始';
  [clear, speed, halfLife].forEach(control => { control.disabled = true; });
  status.textContent = `実行できませんでした: ${message}`;
}
async function shader(name, token) {
  const response = await fetch(new URL(name, import.meta.url));
  if (!response.ok) throw new Error(`${name}の取得に失敗しました: ${response.status}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    throw new Error(`${name}: WGSLはUTF-8 BOMなしで保存してください`);
  }
  let code;
  try { code = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); }
  catch { throw new Error(`${name}: 不正なUTF-8です`); }
  if (token !== generation) return null;
  const module = device.createShaderModule({ code });
  const compilation = await module.getCompilationInfo();
  if (token !== generation) return null;
  const errors = compilation.messages.filter(message => message.type === 'error');
  if (errors.length) throw new Error(`${name}: ${errors.map(message => message.message).join('; ')}`);
  return module;
}
async function initialize(token) {
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
  const sceneShader = await shader('scene.wgsl', token);
  if (!sceneShader) return false;
  const historyShader = await shader('history.wgsl', token);
  if (!historyShader) return false;
  const presentShader = await shader('present.wgsl', token);
  if (!presentShader) return false;
  device.pushErrorScope('validation');
  optionsBuffer = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  sceneTexture = device.createTexture({
    size: [width, height], format: 'rgba8unorm',
    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
  });
  histories = [0, 1].map(() => device.createTexture({
    size: [width, height], format: 'rgba8unorm',
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
  }));
  scenePipeline = await device.createRenderPipelineAsync({
    layout: 'auto',
    vertex: { module: sceneShader, entryPoint: 'vertexMain' },
    fragment: { module: sceneShader, entryPoint: 'fragmentMain', targets: [{ format: 'rgba8unorm' }] },
  });
  if (token !== generation) return false;
  sceneGroup = device.createBindGroup({ layout: scenePipeline.getBindGroupLayout(0), entries: [
    { binding: 0, resource: { buffer: optionsBuffer } },
  ] });
  computePipeline = await device.createComputePipelineAsync({
    layout: 'auto', compute: { module: historyShader, entryPoint: 'computeMain' },
  });
  if (token !== generation) return false;
  computeGroups = [0, 1].map(index => device.createBindGroup({
    layout: computePipeline.getBindGroupLayout(0), entries: [
      { binding: 0, resource: sceneTexture.createView() },
      { binding: 1, resource: histories[index].createView() },
      { binding: 2, resource: histories[1 - index].createView() },
      { binding: 3, resource: { buffer: optionsBuffer } },
    ],
  }));
  presentPipeline = await device.createRenderPipelineAsync({
    layout: 'auto',
    vertex: { module: presentShader, entryPoint: 'vertexMain' },
    fragment: { module: presentShader, entryPoint: 'fragmentMain', targets: [{ format }] },
  });
  if (token !== generation) return false;
  const sampler = device.createSampler({ minFilter: 'linear', magFilter: 'linear' });
  presentGroups = histories.map(texture => device.createBindGroup({
    layout: presentPipeline.getBindGroupLayout(0), entries: [
      { binding: 0, resource: texture.createView() }, { binding: 1, resource: sampler },
    ],
  }));
  const error = await device.popErrorScope();
  if (token !== generation) return false;
  if (error) throw new Error(error.message);
  time = 0;
  detail('GPU情報', adapter.info?.description || '機種名を取得できませんでした');
  detail('Render → Compute → Render', 'シーン → 残像の更新 → Canvas');
  detail('履歴テクスチャ', '320×180 rgba8unorm × 2枚 · ping-pong');
  detail('Dispatch', '40×23 workgroups · 8×8 threads/group');
  return true;
}
function attachment(view) {
  return { view, clearValue: { r: 0, g: 0, b: 0, a: 1 }, loadOp: 'clear', storeOp: 'store' };
}
function clearHistory() {
  const encoder = device.createCommandEncoder();
  for (const texture of histories) {
    const pass = encoder.beginRenderPass({ colorAttachments: [attachment(texture.createView())] });
    pass.end();
  }
  device.queue.submit([encoder.finish()]);
  readIndex = 0;
}
function draw(delta) {
  device.queue.writeBuffer(optionsBuffer, 0, new Float32Array([time, delta, Number(halfLife.value), width / height]));
  const writeIndex = 1 - readIndex;
  const encoder = device.createCommandEncoder();
  const scene = encoder.beginRenderPass({ colorAttachments: [attachment(sceneTexture.createView())] });
  scene.setPipeline(scenePipeline);
  scene.setBindGroup(0, sceneGroup);
  scene.draw(3);
  scene.end();
  const compute = encoder.beginComputePass();
  compute.setPipeline(computePipeline);
  compute.setBindGroup(0, computeGroups[readIndex]);
  compute.dispatchWorkgroups(Math.ceil(width / 8), Math.ceil(height / 8));
  compute.end();
  const present = encoder.beginRenderPass({ colorAttachments: [attachment(context.getCurrentTexture().createView())] });
  present.setPipeline(presentPipeline);
  present.setBindGroup(0, presentGroups[writeIndex]);
  present.draw(3);
  present.end();
  device.queue.submit([encoder.finish()]);
  readIndex = writeIndex;
}
function tick(timestamp) {
  if (!running) return;
  // Clamp long gaps so background tabs do not jump forward on return.
  const delta = lastTimestamp === null ? 1 / 60 : Math.min((timestamp - lastTimestamp) / 1000, 1 / 30);
  lastTimestamp = timestamp;
  time += delta * Number(speed.value);
  try {
    draw(delta);
    frame = requestAnimationFrame(tick);
  } catch (error) { fail(error.message); }
}
async function start() {
  if (busy || running) return;
  busy = true;
  button.disabled = true;
  const token = generation;
  try {
    if (!device) {
      info.replaceChildren();
      status.textContent = 'WebGPUを初期化しています';
      if (!await initialize(token)) return;
      device.pushErrorScope('validation');
      clearHistory();
      draw(1 / 60);
      const error = await device.popErrorScope();
      if (token !== generation) return;
      if (error) throw new Error(error.message);
      await device.queue.onSubmittedWorkDone();
      if (token !== generation) return;
    }
    running = true;
    lastTimestamp = null;
    stop.disabled = false;
    [clear, speed, halfLife].forEach(control => { control.disabled = false; });
    status.textContent = '描画中 · 動く光点と残像を表示しています';
    frame = requestAnimationFrame(tick);
  } catch (error) {
    if (token === generation) fail(error.message);
  } finally {
    if (token === generation) { busy = false; button.disabled = running; }
  }
}
button.addEventListener('click', start);
stop.addEventListener('click', () => { pause(); status.textContent = '停止中 · 再開で続きから描画します'; });
clear.addEventListener('click', () => {
  if (!device || busy) return;
  try {
    clearHistory();
    draw(1 / 60);
    lastTimestamp = null;
    status.textContent = running ? '履歴をクリアしました · 描画中' : '履歴をクリアしました · 停止中';
  } catch (error) { fail(error.message); }
});
speed.addEventListener('input', () => {
  document.querySelector('#gpu-speed-value').textContent = `${Number(speed.value).toFixed(1)}倍`;
});
halfLife.addEventListener('input', () => {
  document.querySelector('#gpu-half-life-value').textContent = `${Number(halfLife.value).toFixed(1)}秒`;
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden && running) { pause(); status.textContent = '停止中 · 再開で続きから描画します'; }
});
window.addEventListener('pagehide', () => {
  generation++;
  busy = false;
  release();
  button.disabled = false;
  button.textContent = '開始';
  [clear, speed, halfLife].forEach(control => { control.disabled = true; });
  status.textContent = '開始ボタンで再初期化します';
});
