// All resources and initialization belong to this Test.
const button = document.querySelector('#gpu-start');
const status = document.querySelector('#gpu-status');
const canvas = document.querySelector('#gpu-canvas');
const info = document.querySelector('#gpu-info');
const blur = document.querySelector('#gpu-blur');
let device, context, pipeline, vertexBuffer, indexBuffer;
let offscreen, offscreenView, optionsBuffer, postPipeline, postGroup;
let generation = 0;
let busy = false;
const vertices = new Float32Array([
  -0.45,  0.65,  0.85, 0.85, 0.95,
   0.45,  0.65,  0.30, 0.75, 0.80,
   0.45, -0.65,  0.85, 0.75, 0.30,
  -0.45, -0.65,  0.45, 0.40, 0.80,
]);
const indices = new Uint16Array([0, 1, 2, 0, 2, 3]);
const vertexLayout = {
  arrayStride: 20,
  stepMode: 'vertex',
  attributes: [
    { shaderLocation: 0, offset: 0, format: 'float32x2' },
    { shaderLocation: 1, offset: 8, format: 'float32x3' },
  ],
};
function detail(label, value) {
  const dt = document.createElement('dt');
  const dd = document.createElement('dd');
  dt.textContent = label;
  dd.textContent = value;
  info.append(dt, dd);
}
function release() {
  context?.unconfigure();
  vertexBuffer?.destroy();
  indexBuffer?.destroy();
  offscreen?.destroy();
  optionsBuffer?.destroy();
  offscreen = offscreenView = optionsBuffer = postPipeline = postGroup = undefined;
  device?.destroy();
  device = context = pipeline = vertexBuffer = indexBuffer = undefined;
}
function fail(message) {
  generation++;
  release();
  busy = false;
  button.disabled = false;
  blur.disabled = true;
  status.textContent = `実行できませんでした: ${message}`;
}
async function loadShader(name, token) {
  const response = await fetch(new URL(name, import.meta.url));
  if (!response.ok) throw new Error(`WGSLの取得に失敗しました: ${response.status}`);
  const code = await response.text();
  if (token !== generation) return null;
  const shader = device.createShaderModule({ code });
  const compilation = await shader.getCompilationInfo();
  if (token !== generation) return null;
  const errors = compilation.messages.filter(message => message.type === 'error');
  if (errors.length) throw new Error(errors.map(message => message.message).join('; '));
  return shader;
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
  const shader = await loadShader('quad.wgsl', token);
  if (!shader) return false;
  const postShader = await loadShader('blur.wgsl', token);
  if (!postShader) return false;
  device.pushErrorScope('validation');
  vertexBuffer = device.createBuffer({ size: vertices.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
  indexBuffer = device.createBuffer({ size: indices.byteLength, usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST });
  device.queue.writeBuffer(vertexBuffer, 0, vertices);
  device.queue.writeBuffer(indexBuffer, 0, indices);
  pipeline = await device.createRenderPipelineAsync({
    layout: 'auto',
    vertex: { module: shader, entryPoint: 'vertexMain', buffers: [vertexLayout] },
    fragment: { module: shader, entryPoint: 'fragmentMain', targets: [{ format: 'rgba8unorm' }] },
    primitive: { topology: 'triangle-list', cullMode: 'none' },
  });
  if (token !== generation) return false;
  offscreen = device.createTexture({
    size: [240, 135], format: 'rgba8unorm',
    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
  });
  offscreenView = offscreen.createView();
  optionsBuffer = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const sampler = device.createSampler({
    minFilter: 'linear', magFilter: 'linear',
    addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge',
  });
  const layout = device.createBindGroupLayout({ entries: [
    { binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
    { binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
    { binding: 2, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform', minBindingSize: 16 } },
  ] });
  postPipeline = await device.createRenderPipelineAsync({
    layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
    vertex: { module: postShader, entryPoint: 'vertexMain' },
    fragment: { module: postShader, entryPoint: 'fragmentMain', targets: [{ format }] },
    primitive: { topology: 'triangle-list' },
  });
  if (token !== generation) return false;
  postGroup = device.createBindGroup({ layout, entries: [
    { binding: 0, resource: offscreenView },
    { binding: 1, resource: sampler },
    { binding: 2, resource: { buffer: optionsBuffer } },
  ] });
  const error = await device.popErrorScope();
  if (token !== generation) return false;
  if (error) throw new Error(error.message);
  detail('GPU情報', adapter.info?.description || '機種名を取得できませんでした');
  detail('頂点・インデックス', '4頂点 / 6インデックス · stride 20バイト / uint16');
  detail('Pass 1 → Pass 2', '240×135 rgba8unorm → 960×540 Canvas · 3×3 / 9サンプル');
  return true;
}
async function render() {
  if (busy) return;
  busy = true;
  button.disabled = true;
  blur.disabled = true;
  const token = generation;
  try {
    if (!device) {
      info.replaceChildren();
      status.textContent = 'WebGPUを初期化しています';
      if (!await initialize(token)) return;
    }
    device.pushErrorScope('validation');
    device.queue.writeBuffer(optionsBuffer, 0, new Float32Array([blur.checked ? 1 : 0, 0, 0, 0]));
    const encoder = device.createCommandEncoder();
    const scene = encoder.beginRenderPass({ colorAttachments: [{
      view: offscreenView,
      clearValue: { r: 0.025, g: 0.035, b: 0.05, a: 1 },
      loadOp: 'clear', storeOp: 'store',
    }] });
    scene.setPipeline(pipeline);
    scene.setVertexBuffer(0, vertexBuffer);
    scene.setIndexBuffer(indexBuffer, 'uint16');
    scene.drawIndexed(6);
    scene.end();
    const post = encoder.beginRenderPass({ colorAttachments: [{
      view: context.getCurrentTexture().createView(),
      clearValue: { r: 0, g: 0, b: 0, a: 1 },
      loadOp: 'clear', storeOp: 'store',
    }] });
    post.setPipeline(postPipeline);
    post.setBindGroup(0, postGroup);
    post.draw(3);
    post.end();
    device.queue.submit([encoder.finish()]);
    const error = await device.popErrorScope();
    if (token !== generation) return;
    if (error) throw new Error(error.message);
    await device.queue.onSubmittedWorkDone();
    if (token !== generation) return;
    status.textContent = blur.checked ? '描画完了 · ブラー有効' : '描画完了 · ブラー無効';
    button.textContent = '再実行';
  } catch (error) {
    if (token === generation) fail(error.message);
  } finally {
    if (token === generation) {
      busy = false;
      button.disabled = false;
      blur.disabled = !device;
    }
  }
}
button.addEventListener('click', render);
blur.addEventListener('change', render);
window.addEventListener('pagehide', () => {
  generation++;
  release();
  busy = false;
  button.disabled = false;
  blur.disabled = true;
  status.textContent = '実行ボタンで再初期化します';
});
