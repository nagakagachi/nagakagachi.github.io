// This Test owns all runtime code; no imports from other experiments.
export {};
type Vec3 = [number, number, number];
type Mat4 = Float32Array<ArrayBuffer>;
function element<T extends Element>(selector: string, type: { new(): T }): T {
  const result = document.querySelector(selector);
  if (!(result instanceof type)) throw new Error(`要素が見つかりません: ${selector}`);
  return result;
}
const button = element('#gpu-start', HTMLButtonElement);
const stop = element('#gpu-stop', HTMLButtonElement);
const filtering = element('#gpu-filter', HTMLSelectElement);
const displayMode = element('#gpu-view', HTMLSelectElement);
const canvas = element('#gpu-canvas', HTMLCanvasElement);
const status = element('#gpu-status', HTMLParagraphElement);
const info = element('#gpu-info', HTMLDListElement);
const near = 1.0;
let generation = 0;
let busy = false;
let running = false;
let frame = 0;
const initialTime = 0.55;
let time = initialTime;
let lastTimestamp: number | undefined;
interface Demo {
  draw(time: number): void;
  dispose(): void;
}
let demo: Demo | undefined;

// Column-major matrices and column vectors, matching WGSL mat4x4f * vec4f.
function multiply(a: Mat4, b: Mat4): Mat4 {
  const out = new Float32Array(16);
  for (let column = 0; column < 4; column++) {
    for (let row = 0; row < 4; row++) {
      for (let k = 0; k < 4; k++) out[column * 4 + row] += a[k * 4 + row] * b[column * 4 + k];
    }
  }
  return out;
}
function normalize(v: Vec3): Vec3 {
  const length = Math.hypot(...v);
  return [v[0] / length, v[1] / length, v[2] / length];
}
function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
function dot(a: Vec3, b: Vec3): number { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
function lookAt(eye: Vec3, target: Vec3): Mat4 {
  const z = normalize([eye[0] - target[0], eye[1] - target[1], eye[2] - target[2]]);
  const x = normalize(cross([0, 1, 0], z));
  const y = cross(z, x);
  return new Float32Array([
    x[0], y[0], z[0], 0,
    x[1], y[1], z[1], 0,
    x[2], y[2], z[2], 0,
    -dot(x, eye), -dot(y, eye), -dot(z, eye), 1,
  ]);
}
function reversedPerspective(aspect: number): Mat4 {
  const f = 1 / Math.tan(Math.PI / 6);
  // Right-handed view space: clip.z = near, clip.w = -view.z.
  // Hence NDC Z = near / distance: near -> 1, infinity -> 0.
  return new Float32Array([f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, 0, -1, 0, 0, near, 0]);
}
function model(angle: number, position: Vec3): Mat4 {
  const cy = Math.cos(angle), sy = Math.sin(angle);
  const cx = Math.cos(angle * 0.7), sx = Math.sin(angle * 0.7);
  const ry = new Float32Array([cy, 0, -sy, 0, 0, 1, 0, 0, sy, 0, cy, 0, ...position, 1]);
  const rx = new Float32Array([1, 0, 0, 0, 0, cx, sx, 0, 0, -sx, cx, 0, 0, 0, 0, 1]);
  return multiply(ry, rx);
}
function cubeVertices(): Float32Array<ArrayBuffer> {
  // Each face owns four vertices so its UVs span the full texture.
  const faces = [
    [-1,-1, 1,  1,-1, 1,  1, 1, 1, -1, 1, 1],
    [ 1,-1,-1, -1,-1,-1, -1, 1,-1,  1, 1,-1],
    [-1, 1, 1,  1, 1, 1,  1, 1,-1, -1, 1,-1],
    [-1,-1,-1,  1,-1,-1,  1,-1, 1, -1,-1, 1],
    [ 1,-1, 1,  1,-1,-1,  1, 1,-1,  1, 1, 1],
    [-1,-1,-1, -1,-1, 1, -1, 1, 1, -1, 1,-1],
  ];
  const uvs = [[0, 1], [1, 1], [1, 0], [0, 0]];
  const data: number[] = [];
  faces.forEach(face => {
    for (let v = 0; v < 4; v++) data.push(face[v * 3], face[v * 3 + 1], face[v * 3 + 2], ...uvs[v]);
  });
  return new Float32Array(data);
}
function detail(label: string, value: string): void {
  const dt = document.createElement('dt'), dd = document.createElement('dd');
  dt.textContent = label;
  dd.textContent = value;
  info.append(dt, dd);
}
function pause(): void {
  running = false;
  cancelAnimationFrame(frame);
  lastTimestamp = undefined;
  stop.disabled = true;
  button.disabled = busy;
  button.textContent = demo ? '再開' : '開始';
}
function fail(error: unknown): void {
  generation++;
  busy = false;
  pause();
  demo?.dispose();
  demo = undefined;
  button.disabled = false;
  button.textContent = '開始';
  [filtering, displayMode].forEach(control => { control.disabled = true; });
  status.textContent = `実行できませんでした: ${error instanceof Error ? error.message : String(error)}`;
}
function updateStatus(): void {
  status.textContent = `${running ? '描画中' : '停止中'} · ${displayMode.value === 'texture' ? '生成テクスチャ' : 'Cube'} · ${filtering.value === 'linear' ? 'Linear' : 'Nearest'} · テクスチャ生成は初期化時のみ`;
}
async function initialize(token: number): Promise<Demo> {
  if (!window.isSecureContext || !navigator.gpu) throw new Error('WebGPU対応ブラウザでHTTPSまたはlocalhostから開いてください');
  const check = (): void => { if (token !== generation) throw new Error('初期化を中断しました'); };
  const adapter = await navigator.gpu.requestAdapter();
  check();
  if (!adapter) throw new Error('GPUアダプターを取得できませんでした');
  const device = await adapter.requestDevice();
  const buffers: GPUBuffer[] = [];
  let depth: GPUTexture | undefined;
  let texture: GPUTexture | undefined;
  let context: GPUCanvasContext | null = null;
  const dispose = (): void => {
    if (token === generation) context?.unconfigure();
    buffers.forEach(buffer => buffer.destroy());
    depth?.destroy();
    texture?.destroy();
    device.destroy();
  };
  try {
    check();
    context = canvas.getContext('webgpu');
    if (!context) throw new Error('WebGPU Canvasを取得できませんでした');
    const activeContext = context;
    const format = navigator.gpu.getPreferredCanvasFormat();
    activeContext.configure({ device, format, alphaMode: 'opaque' });
    device.lost.then(({ reason, message }) => {
      if (token === generation && reason !== 'destroyed') fail(new Error(`GPUデバイスを失いました: ${message || reason}`));
    });
    device.addEventListener('uncapturederror', event => {
      if (token === generation) fail(event.error);
    });
    async function shader(name: string): Promise<GPUShaderModule> {
      const response = await fetch(new URL(name, import.meta.url));
      if (!response.ok) throw new Error(`${name}: HTTP ${response.status}`);
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) throw new Error(`${name}: UTF-8 BOMは使用できません`);
      let code: string;
      try { code = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); }
      catch { throw new Error(`${name}: 不正なUTF-8です`); }
      check();
      const module = device.createShaderModule({ code });
      const compilation = await module.getCompilationInfo();
      check();
      const errors = compilation.messages.filter(message => message.type === 'error');
      if (errors.length) throw new Error(`${name}: ${errors.map(message => message.message).join('; ')}`);
      return module;
    }
    const cubeShader = await shader('cube.wgsl');
    const generateShader = await shader('generate.wgsl');
    device.pushErrorScope('validation');
    function buffer(data: Float32Array<ArrayBuffer> | Uint16Array<ArrayBuffer>, usage: GPUBufferUsageFlags): GPUBuffer {
      const result = device.createBuffer({ size: data.byteLength, usage: usage | GPUBufferUsage.COPY_DST });
      buffers.push(result);
      device.queue.writeBuffer(result, 0, data);
      return result;
    }
    const vertices = buffer(cubeVertices(), GPUBufferUsage.VERTEX);
    const indexData: number[] = [];
    for (let face = 0; face < 6; face++) for (const i of [0, 1, 2, 0, 2, 3]) indexData.push(face * 4 + i);
    const indices = buffer(new Uint16Array(indexData), GPUBufferUsage.INDEX);
    const uniform = buffer(new Float32Array(16), GPUBufferUsage.UNIFORM);
    depth = device.createTexture({
      size: [canvas.width, canvas.height], format: 'depth32float',
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });
    const depthView = depth.createView();
    texture = device.createTexture({
      size: [256, 256], format: 'rgba8unorm', mipLevelCount: 1,
      usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING,
    });
    const textureView = texture.createView();
    const generatePipeline = await device.createComputePipelineAsync({
      layout: 'auto', compute: { module: generateShader, entryPoint: 'computeMain' },
    });
    check();
    const generateGroup = device.createBindGroup({ layout: generatePipeline.getBindGroupLayout(0), entries: [
      { binding: 0, resource: textureView },
    ] });
    // Generate once during initialization. draw() never dispatches Compute.
    const generateEncoder = device.createCommandEncoder();
    const generatePass = generateEncoder.beginComputePass();
    generatePass.setPipeline(generatePipeline);
    generatePass.setBindGroup(0, generateGroup);
    generatePass.dispatchWorkgroups(32, 32);
    generatePass.end();
    device.queue.submit([generateEncoder.finish()]);
    const objectLayout = device.createBindGroupLayout({ entries: [
      { binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: 'uniform', minBindingSize: 64 } },
    ] });
    const textureLayout = device.createBindGroupLayout({ entries: [
      { binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
      { binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
    ] });
    const layout = device.createPipelineLayout({ bindGroupLayouts: [objectLayout, textureLayout] });
    const pipeline = await device.createRenderPipelineAsync({
      layout,
      vertex: { module: cubeShader, entryPoint: 'vertexMain', buffers: [{ arrayStride: 20, attributes: [
        { shaderLocation: 0, offset: 0, format: 'float32x3' },
        { shaderLocation: 1, offset: 12, format: 'float32x2' },
      ] }] },
      fragment: { module: cubeShader, entryPoint: 'fragmentMain', targets: [{ format }] },
      primitive: { topology: 'triangle-list', cullMode: 'back', frontFace: 'ccw' },
      depthStencil: { format: 'depth32float', depthWriteEnabled: true, depthCompare: 'greater' },
    });
    check();
    const objectGroup = device.createBindGroup({ layout: objectLayout, entries: [
      { binding: 0, resource: { buffer: uniform } },
    ] });
    const textureGroups = new Map<string, GPUBindGroup>();
    for (const filter of ['nearest', 'linear'] satisfies GPUFilterMode[]) {
      const sampler = device.createSampler({
        minFilter: filter, magFilter: filter,
        addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge',
      });
      textureGroups.set(filter, device.createBindGroup({ layout: textureLayout, entries: [
        { binding: 0, resource: textureView }, { binding: 1, resource: sampler },
      ] }));
    }
    const previewPipeline = await device.createRenderPipelineAsync({
      layout,
      vertex: { module: cubeShader, entryPoint: 'previewVertex' },
      fragment: { module: cubeShader, entryPoint: 'fragmentMain', targets: [{ format }] },
    });
    check();
    const error = await device.popErrorScope();
    check();
    if (error) throw new Error(error.message);
    const viewProjection = multiply(reversedPerspective(canvas.width / canvas.height), lookAt([0, 1.6, 6], [0, 0, 0]));
    function draw(t: number): void {
      const group = textureGroups.get(filtering.value);
      if (!group) throw new Error('不明なフィルタです');
      const mvp = multiply(viewProjection, model(t * 0.5, [0, 0, 0]));
      device.queue.writeBuffer(uniform, 0, mvp);
      const encoder = device.createCommandEncoder();
      const target = activeContext.getCurrentTexture().createView();
      const preview = displayMode.value === 'texture';
      const pass = encoder.beginRenderPass({
        colorAttachments: [{ view: target, clearValue: { r: 0.035, g: 0.05, b: 0.065, a: 1 }, loadOp: 'clear', storeOp: 'store' }],
        ...(preview ? {} : { depthStencilAttachment: { view: depthView, depthClearValue: 0.0,
          depthLoadOp: 'clear', depthStoreOp: 'store' } }),
      });
      pass.setPipeline(preview ? previewPipeline : pipeline);
      pass.setBindGroup(0, objectGroup);
      pass.setBindGroup(1, group);
      if (preview) {
        // Keep the 1:1 texture aspect ratio in the middle of the wide Canvas.
        pass.setViewport((canvas.width - canvas.height) / 2, 0, canvas.height, canvas.height, 0, 1);
        pass.draw(3);
      } else {
        pass.setVertexBuffer(0, vertices);
        pass.setIndexBuffer(indices, 'uint16');
        pass.drawIndexed(36);
      }
      pass.end();
      device.queue.submit([encoder.finish()]);
    }
    device.pushErrorScope('validation');
    draw(initialTime);
    const drawError = await device.popErrorScope();
    check();
    if (drawError) throw new Error(drawError.message);
    await device.queue.onSubmittedWorkDone();
    check();
    detail('GPU情報', adapter.info.description || '機種名を取得できませんでした');
    detail('カメラ', '右手系 · 視野角60° · Near 1 · Far ∞');
    detail('テクスチャ', '256×256 rgba8unorm · 約256 KiB · Mipなし');
    detail('Compute', '初期化時に1回 · 32×32 groups / 8×8 threads · SDFからRGBAを生成');
    detail('深度', 'depth32float · Reversed Z');
    return { draw, dispose };
  } catch (error) { dispose(); throw error; }
}
function tick(timestamp: number): void {
  if (!running || !demo) return;
  const delta = lastTimestamp === undefined ? 0 : Math.min((timestamp - lastTimestamp) / 1000, 1 / 30);
  lastTimestamp = timestamp;
  time += delta;
  try { demo.draw(time); frame = requestAnimationFrame(tick); }
  catch (error) { fail(error); }
}
button.addEventListener('click', async () => {
  if (busy || running) return;
  busy = true;
  button.disabled = true;
  const token = generation;
  try {
    if (!demo) {
      info.replaceChildren();
      status.textContent = 'WebGPUを初期化しています';
      const initialized = await initialize(token);
      if (token !== generation) { initialized.dispose(); return; }
      demo = initialized;
      time = initialTime;
    }
    busy = false;
    running = true;
    lastTimestamp = undefined;
    stop.disabled = false;
    [filtering, displayMode].forEach(control => { control.disabled = false; });
    updateStatus();
    frame = requestAnimationFrame(tick);
  } catch (error) { if (token === generation) fail(error); }
});
stop.addEventListener('click', () => { pause(); updateStatus(); });
for (const control of [filtering, displayMode]) control.addEventListener('change', () => {
  try { demo?.draw(time); updateStatus(); }
  catch (error) { fail(error); }
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden && running) { pause(); updateStatus(); }
});
window.addEventListener('pagehide', () => {
  pause();
  demo?.dispose();
  demo = undefined;
  generation++;
  busy = false;
  button.disabled = false;
  button.textContent = '開始';
  [filtering, displayMode].forEach(control => { control.disabled = true; });
  status.textContent = '開始ボタンで再初期化します';
});
