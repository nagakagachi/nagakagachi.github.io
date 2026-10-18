// Independent Test07 runtime. No shared experiment code or runtime dependencies.
export {};
type Vec3 = [number, number, number];
type Mat4 = Float32Array<ArrayBuffer>;
function element<T extends Element>(selector: string, type: { new(): T }): T {
  const result = document.querySelector(selector);
  if (!(result instanceof type)) throw new Error(`要素が見つかりません: ${selector}`);
  return result;
}
const button = element('#gpu-start', HTMLButtonElement);
const canvas = element('#gpu-canvas', HTMLCanvasElement);
const status = element('#gpu-status', HTMLParagraphElement);
const info = element('#gpu-info', HTMLDListElement);
const albedoControl = element('#gpu-albedo', HTMLInputElement);
const roughnessControl = element('#gpu-roughness', HTMLInputElement);
const metallicControl = element('#gpu-metallic', HTMLInputElement);
const azimuthControl = element('#gpu-azimuth', HTMLInputElement);
const elevationControl = element('#gpu-elevation', HTMLInputElement);
const viewControl = element('#gpu-view', HTMLSelectElement);
const reset = element('#gpu-reset', HTMLButtonElement);
const controls = [albedoControl, roughnessControl, metallicControl, azimuthControl, elevationControl, viewControl, reset];
const near = 0.1;
const camera: Vec3 = [0, 0, 3];
let generation = 0;
let busy = false;
let pending = false;
interface Demo { draw(): void; dispose(): void; }
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

function sphereMesh(): { vertices: Float32Array<ArrayBuffer>; indices: Uint16Array<ArrayBuffer> } {
  const longitude = 128, latitude = 64;
  const vertices: number[] = [], indices: number[] = [];
  for (let y = 0; y <= latitude; y++) {
    const v = y / latitude, theta = v * Math.PI;
    for (let x = 0; x <= longitude; x++) {
      const u = x / longitude, phi = u * Math.PI * 2;
      const nx = Math.sin(theta) * Math.cos(phi), ny = Math.cos(theta), nz = Math.sin(theta) * Math.sin(phi);
      vertices.push(nx, ny, nz, nx, ny, nz, u, v);
    }
  }
  for (let y = 0; y < latitude; y++) for (let x = 0; x < longitude; x++) {
    const a = y * (longitude + 1) + x, b = a + 1, c = a + longitude + 1, d = c + 1;
    if (y > 0) indices.push(a, b, c);
    if (y < latitude - 1) indices.push(b, d, c);
  }
  return { vertices: new Float32Array(vertices), indices: new Uint16Array(indices) };
}
function detail(label: string, value: string): void {
  const dt = document.createElement('dt'), dd = document.createElement('dd');
  dt.textContent = label; dd.textContent = value; info.append(dt, dd);
}
function fail(error: unknown): void {
  demo?.dispose(); demo = undefined;
  generation++; busy = false; pending = false;
  button.disabled = false; button.textContent = '実行';
  controls.forEach(control => { control.disabled = true; });
  status.textContent = `実行できませんでした: ${error instanceof Error ? error.message : String(error)}`;
}
function updateOutputs(): void {
  for (const [control, digits, suffix] of [
    [roughnessControl, 2, ''], [metallicControl, 2, ''], [azimuthControl, 0, '°'], [elevationControl, 0, '°'],
  ] satisfies [HTMLInputElement, number, string][]) {
    element(`#${control.id}-value`, HTMLOutputElement).value = Number(control.value).toFixed(digits) + suffix;
  }
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
    const lightingShader = await shader('lighting.wgsl');
    const generateShader = await shader('generate.wgsl');
    device.pushErrorScope('validation');
    function buffer(data: Float32Array<ArrayBuffer> | Uint16Array<ArrayBuffer>, usage: GPUBufferUsageFlags): GPUBuffer {
      const result = device.createBuffer({ size: data.byteLength, usage: usage | GPUBufferUsage.COPY_DST });
      buffers.push(result);
      device.queue.writeBuffer(result, 0, data);
      return result;
    }
    const mesh = sphereMesh();
    const vertices = buffer(mesh.vertices, GPUBufferUsage.VERTEX);
    const indices = buffer(mesh.indices, GPUBufferUsage.INDEX);
    const uniform = buffer(new Float32Array(32), GPUBufferUsage.UNIFORM);
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
      { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform', minBindingSize: 128 } },
    ] });
    const textureLayout = device.createBindGroupLayout({ entries: [
      { binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
      { binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
    ] });
    const layout = device.createPipelineLayout({ bindGroupLayouts: [objectLayout, textureLayout] });
    const pipeline = await device.createRenderPipelineAsync({
      layout,
      vertex: { module: lightingShader, entryPoint: 'vertexMain', buffers: [{ arrayStride: 32, attributes: [
        { shaderLocation: 0, offset: 0, format: 'float32x3' },
        { shaderLocation: 1, offset: 12, format: 'float32x3' },
        { shaderLocation: 2, offset: 24, format: 'float32x2' },
      ] }] },
      fragment: { module: lightingShader, entryPoint: 'fragmentMain', targets: [{ format }] },
      primitive: { topology: 'triangle-list', cullMode: 'back', frontFace: 'ccw' },
      depthStencil: { format: 'depth32float', depthWriteEnabled: true, depthCompare: 'greater' },
    });
    check();
    const objectGroup = device.createBindGroup({ layout: objectLayout, entries: [
      { binding: 0, resource: { buffer: uniform } },
    ] });
    const sampler = device.createSampler({
      minFilter: 'linear', magFilter: 'linear', addressModeU: 'repeat', addressModeV: 'clamp-to-edge',
    });
    const textureGroup = device.createBindGroup({ layout: textureLayout, entries: [
      { binding: 0, resource: textureView }, { binding: 1, resource: sampler },
    ] });
    const error = await device.popErrorScope();
    check();
    if (error) throw new Error(error.message);
    const viewProjection = multiply(reversedPerspective(canvas.width / canvas.height), lookAt(camera, [0, 0, 0]));
    function draw(): void {
      const azimuth = Number(azimuthControl.value) * Math.PI / 180;
      const elevation = Number(elevationControl.value) * Math.PI / 180;
      const light: Vec3 = [Math.cos(elevation) * Math.sin(azimuth), Math.sin(elevation), Math.cos(elevation) * Math.cos(azimuth)];
      const data = new Float32Array(32);
      data.set(viewProjection, 0);
      data.set([...camera, 0], 16);
      data.set([...light, 0], 20);
      data.set([Number(roughnessControl.value), Number(metallicControl.value), albedoControl.checked ? 1 : 0, Number(viewControl.value)], 24);
      data.set([0.42, 0.16, 0.065, 4.0], 28);
      device.queue.writeBuffer(uniform, 0, data);
      const encoder = device.createCommandEncoder();
      const pass = encoder.beginRenderPass({
        colorAttachments: [{ view: activeContext.getCurrentTexture().createView(),
          clearValue: { r: 0.025, g: 0.035, b: 0.045, a: 1 }, loadOp: 'clear', storeOp: 'store' }],
        depthStencilAttachment: { view: depthView, depthClearValue: 0, depthLoadOp: 'clear', depthStoreOp: 'store' },
      });
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, objectGroup);
      pass.setBindGroup(1, textureGroup);
      pass.setVertexBuffer(0, vertices);
      pass.setIndexBuffer(indices, 'uint16');
      pass.drawIndexed(mesh.indices.length);
      pass.end();
      device.queue.submit([encoder.finish()]);
    }
    device.pushErrorScope('validation');
    draw();
    const drawError = await device.popErrorScope();
    check();
    if (drawError) throw new Error(drawError.message);
    await device.queue.onSubmittedWorkDone();
    check();
    detail('GPU情報', adapter.info.description || '機種名を取得できませんでした');
    detail('メッシュ', `${mesh.vertices.length / 8}頂点 / ${mesh.indices.length / 3}三角形 · UV球`);
    detail('モデル', 'Lambert + GGX D / 非相関Smith G / Schlick F');
    detail('アルベド', '256×256 rgba8unorm · 線形値 · Compute生成は初期化時の1回');
    detail('描画', 'Reversed Z · 直接光のみ · UI変更時に再描画');
    return { draw, dispose };
  } catch (error) { dispose(); throw error; }
}

async function render(): Promise<void> {
  if (busy) { pending = true; return; }
  busy = true; button.disabled = true;
  const token = generation;
  try {
    if (!demo) {
      info.replaceChildren(); status.textContent = 'WebGPUを初期化しています';
      const initialized = await initialize(token);
      if (token !== generation) { initialized.dispose(); return; }
      demo = initialized;
    }
    demo.draw();
    status.textContent = '描画完了 · UI変更時に再描画します';
    button.textContent = '再描画';
    controls.forEach(control => { control.disabled = false; });
  } catch (error) { if (token === generation) fail(error); }
  finally {
    if (token === generation) {
      busy = false; button.disabled = false;
      if (pending) { pending = false; void render(); }
    }
  }
}
button.addEventListener('click', () => { void render(); });
for (const control of [roughnessControl, metallicControl, azimuthControl, elevationControl]) {
  control.addEventListener('input', () => { updateOutputs(); if (demo) void render(); });
}
for (const control of [albedoControl, viewControl]) control.addEventListener('change', () => { if (demo) void render(); });
reset.addEventListener('click', () => {
  albedoControl.checked = true; roughnessControl.value = '0.35'; metallicControl.value = '0';
  azimuthControl.value = '-35'; elevationControl.value = '35'; viewControl.value = '0';
  updateOutputs(); if (demo) void render();
});
window.addEventListener('pagehide', () => {
  demo?.dispose(); demo = undefined; generation++; busy = false; pending = false;
  button.disabled = false; button.textContent = '実行';
  controls.forEach(control => { control.disabled = true; });
  status.textContent = '実行ボタンで再初期化します';
});
updateOutputs();
