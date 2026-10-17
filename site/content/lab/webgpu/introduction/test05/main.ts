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
const depthEnabled = element('#gpu-depth', HTMLInputElement);
const visualize = element('#gpu-visualize', HTMLInputElement);
const canvas = element('#gpu-canvas', HTMLCanvasElement);
const status = element('#gpu-status', HTMLParagraphElement);
const info = element('#gpu-info', HTMLDListElement);
const near = 1.0;
let generation = 0;
let busy = false;
let running = false;
let frame = 0;
const initialTime = 1.8;
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
  // Four separate vertices per face, with a fixed face shade (no lighting pass).
  const faces = [
    [-1,-1, 1,  1,-1, 1,  1, 1, 1, -1, 1, 1],
    [ 1,-1,-1, -1,-1,-1, -1, 1,-1,  1, 1,-1],
    [-1, 1, 1,  1, 1, 1,  1, 1,-1, -1, 1,-1],
    [-1,-1,-1,  1,-1,-1,  1,-1, 1, -1,-1, 1],
    [ 1,-1, 1,  1,-1,-1,  1, 1,-1,  1, 1, 1],
    [-1,-1,-1, -1,-1, 1, -1, 1, 1, -1, 1,-1],
  ];
  const shades = [1, 0.55, 0.9, 0.45, 0.75, 0.65];
  const data: number[] = [];
  faces.forEach((face, i) => {
    for (let v = 0; v < 4; v++) data.push(face[v * 3] * 0.65, face[v * 3 + 1] * 0.65, face[v * 3 + 2] * 0.65, shades[i]);
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
  [depthEnabled, visualize].forEach(control => { control.disabled = true; });
  status.textContent = `実行できませんでした: ${error instanceof Error ? error.message : String(error)}`;
}
function updateStatus(): void {
  status.textContent = `${running ? '描画中' : '停止中'} · ${visualize.checked ? '生の深度値' : 'カラー'} · Depth${depthEnabled.checked ? '有効' : '無効'} · Reversed Z`;
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
  let context: GPUCanvasContext | null = null;
  const dispose = (): void => {
    if (token === generation) context?.unconfigure();
    buffers.forEach(buffer => buffer.destroy());
    depth?.destroy();
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
    const depthShader = await shader('depth.wgsl');
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
    const uniforms = [0, 1].map(() => buffer(new Float32Array(20), GPUBufferUsage.UNIFORM));
    depth = device.createTexture({
      size: [canvas.width, canvas.height], format: 'depth32float',
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    });
    const depthView = depth.createView();
    // Share this layout between the depth-enabled and disabled PSOs.
    const objectLayout = device.createBindGroupLayout({ entries: [
      { binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: 'uniform', minBindingSize: 80 } },
    ] });
    const layout = device.createPipelineLayout({ bindGroupLayouts: [objectLayout] });
    const pipelines: GPURenderPipeline[] = [];
    for (const enabled of [false, true]) {
      pipelines.push(await device.createRenderPipelineAsync({
        layout,
        vertex: { module: cubeShader, entryPoint: 'vertexMain', buffers: [{ arrayStride: 16, attributes: [
          { shaderLocation: 0, offset: 0, format: 'float32x3' },
          { shaderLocation: 1, offset: 12, format: 'float32' },
        ] }] },
        fragment: { module: cubeShader, entryPoint: 'fragmentMain', targets: [{ format }] },
        primitive: { topology: 'triangle-list', cullMode: 'back', frontFace: 'ccw' },
        depthStencil: { format: 'depth32float', depthWriteEnabled: enabled, depthCompare: enabled ? 'greater' : 'always' },
      }));
      check();
    }
    const groups = uniforms.map(uniform => device.createBindGroup({ layout: objectLayout, entries: [
      { binding: 0, resource: { buffer: uniform } },
    ] }));
    const depthPipeline = await device.createRenderPipelineAsync({
      layout: 'auto',
      vertex: { module: depthShader, entryPoint: 'vertexMain' },
      fragment: { module: depthShader, entryPoint: 'fragmentMain', targets: [{ format }] },
    });
    check();
    const depthGroup = device.createBindGroup({ layout: depthPipeline.getBindGroupLayout(0), entries: [
      { binding: 0, resource: depthView },
    ] });
    const error = await device.popErrorScope();
    check();
    if (error) throw new Error(error.message);
    const viewProjection = multiply(reversedPerspective(canvas.width / canvas.height), lookAt([0, 1.6, 6], [0, 0, 0]));
    const colors = [[0.25, 0.8, 0.95, 1], [0.95, 0.65, 0.25, 1]];
    function draw(t: number): void {
      const x = 1.25 * Math.cos(t * 0.65), z = 1.6 * Math.sin(t * 0.65);
      for (let i = 0; i < 2; i++) {
        const sign = i === 0 ? 1 : -1;
        const mvp = multiply(viewProjection, model(t * (i === 0 ? 0.8 : -0.6), [sign * x, sign * 0.15, sign * z]));
        const data = new Float32Array(20);
        data.set(mvp);
        data.set(colors[i], 16);
        device.queue.writeBuffer(uniforms[i], 0, data);
      }
      const encoder = device.createCommandEncoder();
      const target = activeContext.getCurrentTexture().createView();
      const pass = encoder.beginRenderPass({
        colorAttachments: [{ view: target, clearValue: { r: 0.035, g: 0.05, b: 0.065, a: 1 }, loadOp: 'clear', storeOp: 'store' }],
        depthStencilAttachment: { view: depthView, depthClearValue: 0.0, depthLoadOp: 'clear', depthStoreOp: 'store' },
      });
      pass.setPipeline(pipelines[depthEnabled.checked ? 1 : 0]);
      pass.setVertexBuffer(0, vertices);
      pass.setIndexBuffer(indices, 'uint16');
      for (let i = 0; i < groups.length; i++) {
        pass.setBindGroup(0, groups[i]);
        pass.drawIndexed(36);
      }
      pass.end();
      if (visualize.checked) {
        const display = encoder.beginRenderPass({ colorAttachments: [
          { view: target, loadOp: 'clear', storeOp: 'store', clearValue: { r: 0, g: 0, b: 0, a: 1 } },
        ] });
        display.setPipeline(depthPipeline);
        display.setBindGroup(0, depthGroup);
        display.draw(3);
        display.end();
      }
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
    detail('深度', 'depth32float · Near → 1 / Far → 0 · greater · clear 0');
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
    [depthEnabled, visualize].forEach(control => { control.disabled = false; });
    visualize.disabled = !depthEnabled.checked;
    updateStatus();
    frame = requestAnimationFrame(tick);
  } catch (error) { if (token === generation) fail(error); }
});
stop.addEventListener('click', () => { pause(); updateStatus(); });
for (const control of [depthEnabled, visualize]) control.addEventListener('change', () => {
  // Depth-off leaves the attachment at clear=0. Disable visualization to avoid mistaking that for a failure.
  if (!depthEnabled.checked) { visualize.checked = false; visualize.disabled = true; }
  else visualize.disabled = false;
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
  [depthEnabled, visualize].forEach(control => { control.disabled = true; });
  status.textContent = '開始ボタンで再初期化します';
});
