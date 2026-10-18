// Independent Test08 runtime; all matrices, geometry and GPU setup belong to this Test.
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
const stop = element('#gpu-stop', HTMLButtonElement);
const pcfControl = element('#gpu-pcf', HTMLSelectElement);
const depthBiasControl = element('#gpu-depth-bias', HTMLInputElement);
const normalBiasControl = element('#gpu-normal-bias', HTMLInputElement);
const azimuthControl = element('#gpu-azimuth', HTMLInputElement);
const elevationControl = element('#gpu-elevation', HTMLInputElement);
const viewControl = element('#gpu-view', HTMLSelectElement);
const shadowControl = element('#gpu-shadow', HTMLInputElement);
const reset = element('#gpu-reset', HTMLButtonElement);
const cameraReset = element('#gpu-camera-reset', HTMLButtonElement);
const controls = [pcfControl, depthBiasControl, normalBiasControl, azimuthControl, elevationControl, viewControl, shadowControl, reset, cameraReset];
const near = 0.1, shadowSize = 1024;
const cameraTarget: Vec3 = [0, 0.7, 0];
const initialOrbit = { yaw: Math.atan2(4, 5), pitch: Math.atan2(2.8, Math.hypot(4, 5)), radius: Math.hypot(4, 2.8, 5) };
let orbit = { ...initialOrbit };
function cameraPosition(): Vec3 {
  const horizontal = orbit.radius * Math.cos(orbit.pitch);
  return [cameraTarget[0] + horizontal * Math.sin(orbit.yaw), cameraTarget[1] + orbit.radius * Math.sin(orbit.pitch), cameraTarget[2] + horizontal * Math.cos(orbit.yaw)];
}
let generation = 0, busy = false, running = false, frame = 0;
let time = 0.6;
let lastTimestamp: number | undefined;
interface Demo { draw(time: number): void; dispose(): void; }
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
function lookAt(eye: Vec3, target: Vec3, preferredUp?: Vec3): Mat4 {
  const z = normalize([eye[0] - target[0], eye[1] - target[1], eye[2] - target[2]]);
  const up: Vec3 = preferredUp ?? (Math.abs(z[1]) > 0.98 ? [0, 0, 1] : [0, 1, 0]);
  const x = normalize(cross(up, z));
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

function identity(): Mat4 { return new Float32Array([1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1]); }
function reversedOrthographic(halfSize: number, nearPlane: number, farPlane: number): Mat4 {
  // View forward is -Z. Near -> 1, far -> 0 with no -1..1 depth remapping.
  return new Float32Array([1/halfSize,0,0,0, 0,1/halfSize,0,0,
    0,0,1/(farPlane-nearPlane),0, 0,0,farPlane/(farPlane-nearPlane),1]);
}
function sceneMesh(): { vertices: Float32Array<ArrayBuffer>; indices: Uint16Array<ArrayBuffer> } {
  const vertices = [-3.2,0,-3.2,0,1,0, -3.2,0,3.2,0,1,0, 3.2,0,3.2,0,1,0, 3.2,0,-3.2,0,1,0];
  const indices = [0,1,2,0,2,3];
  const faces = [
    [-1,-1,1,1,-1,1,1,1,1,-1,1,1], [1,-1,-1,-1,-1,-1,-1,1,-1,1,1,-1],
    [-1,1,1,1,1,1,1,1,-1,-1,1,-1], [-1,-1,-1,1,-1,-1,1,-1,1,-1,-1,1],
    [1,-1,1,1,-1,-1,1,1,-1,1,1,1], [-1,-1,-1,-1,-1,1,-1,1,1,-1,1,-1],
  ];
  const normals: Vec3[] = [[0,0,1],[0,0,-1],[0,1,0],[0,-1,0],[1,0,0],[-1,0,0]];
  faces.forEach((face, f) => {
    const start = vertices.length / 6;
    for (let v = 0; v < 4; v++) vertices.push(face[v*3]*0.55,face[v*3+1]*0.55,face[v*3+2]*0.55,...normals[f]);
    for (const i of [0,1,2,0,2,3]) indices.push(start+i);
  });
  return { vertices: new Float32Array(vertices), indices: new Uint16Array(indices) };
}
function detail(label: string, value: string): void {
  const dt = document.createElement('dt'), dd = document.createElement('dd');
  dt.textContent = label; dd.textContent = value; info.append(dt, dd);
}
function pause(): void {
  running = false; cancelAnimationFrame(frame); lastTimestamp = undefined;
  stop.disabled = true; button.disabled = busy; button.textContent = demo ? '再開' : '開始';
}
function fail(error: unknown): void {
  busy = false; pause(); demo?.dispose(); demo = undefined; generation++;
  button.disabled = false; button.textContent = '開始'; controls.forEach(control => { control.disabled = true; });
  updateCameraInteraction();
  status.textContent = `実行できませんでした: ${error instanceof Error ? error.message : String(error)}`;
}
function updateStatus(): void {
  status.textContent = `${running ? '描画中' : '停止中'} · ${viewControl.value === 'shadow' ? 'Shadow Map' : 'シーン'} · 影${shadowControl.checked ? '有効' : '無効'}`;
}
function updateOutputs(): void {
  for (const [control, digits, suffix] of [
    [depthBiasControl,4,''],[normalBiasControl,3,''],[azimuthControl,0,'°'],[elevationControl,0,'°'],
  ] satisfies [HTMLInputElement,number,string][]) {
    element(`#${control.id}-value`,HTMLOutputElement).value=Number(control.value).toFixed(digits)+suffix;
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
  let shadowMap: GPUTexture | undefined;
  let context: GPUCanvasContext | null = null;
  const dispose = (): void => {
    if (token === generation) context?.unconfigure();
    buffers.forEach(buffer => buffer.destroy());
    depth?.destroy();
    shadowMap?.destroy();
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
    const shadowShader = await shader('shadow.wgsl');
    const displayShader = await shader('display.wgsl');
    device.pushErrorScope('validation');
    function buffer(data: Float32Array<ArrayBuffer> | Uint16Array<ArrayBuffer>, usage: GPUBufferUsageFlags): GPUBuffer {
      const result = device.createBuffer({ size: data.byteLength, usage: usage | GPUBufferUsage.COPY_DST });
      buffers.push(result);
      device.queue.writeBuffer(result, 0, data);
      return result;
    }
    const mesh = sceneMesh();
    const vertices = buffer(mesh.vertices, GPUBufferUsage.VERTEX);
    const indices = buffer(mesh.indices, GPUBufferUsage.INDEX);
    const frameBuffer = buffer(new Float32Array(48), GPUBufferUsage.UNIFORM);
    const objectBuffers = [0, 1].map(() => buffer(new Float32Array(20), GPUBufferUsage.UNIFORM));
    depth = device.createTexture({ size: [canvas.width, canvas.height], format: 'depth32float', usage: GPUTextureUsage.RENDER_ATTACHMENT });
    const depthView = depth.createView();
    shadowMap = device.createTexture({ size: [shadowSize, shadowSize], format: 'depth32float',
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING });
    const shadowView = shadowMap.createView();
    const frameLayout = device.createBindGroupLayout({ entries: [
      { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform', minBindingSize: 192 } },
    ] });
    const objectLayout = device.createBindGroupLayout({ entries: [
      { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform', minBindingSize: 80 } },
    ] });
    const shadowLayout = device.createBindGroupLayout({ entries: [
      { binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'depth' } },
      { binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'comparison' } },
    ] });
    const vertexLayout: GPUVertexBufferLayout = { arrayStride: 24, attributes: [
      { shaderLocation: 0, offset: 0, format: 'float32x3' },
      { shaderLocation: 1, offset: 12, format: 'float32x3' },
    ] };
    const shadowPipeline = await device.createRenderPipelineAsync({
      layout: device.createPipelineLayout({ bindGroupLayouts: [frameLayout, objectLayout] }),
      vertex: { module: shadowShader, entryPoint: 'vertexMain', buffers: [vertexLayout] },
      primitive: { topology: 'triangle-list', cullMode: 'back' },
      depthStencil: { format: 'depth32float', depthWriteEnabled: true, depthCompare: 'greater' },
    });
    check();
    const pipeline = await device.createRenderPipelineAsync({
      layout: device.createPipelineLayout({ bindGroupLayouts: [frameLayout, objectLayout, shadowLayout] }),
      vertex: { module: lightingShader, entryPoint: 'vertexMain', buffers: [vertexLayout] },
      fragment: { module: lightingShader, entryPoint: 'fragmentMain', targets: [{ format }] },
      primitive: { topology: 'triangle-list', cullMode: 'back' },
      depthStencil: { format: 'depth32float', depthWriteEnabled: true, depthCompare: 'greater' },
    });
    check();
    const frameGroup = device.createBindGroup({ layout: frameLayout, entries: [{ binding: 0, resource: { buffer: frameBuffer } }] });
    const objectGroups = objectBuffers.map(objectBuffer => device.createBindGroup({ layout: objectLayout,
      entries: [{ binding: 0, resource: { buffer: objectBuffer } }] }));
    const sampler = device.createSampler({ compare: 'greater-equal', minFilter: 'nearest', magFilter: 'nearest' });
    const shadowGroup = device.createBindGroup({ layout: shadowLayout, entries: [
      { binding: 0, resource: shadowView }, { binding: 1, resource: sampler },
    ] });
    const displayPipeline = await device.createRenderPipelineAsync({
      layout: 'auto', vertex: { module: displayShader, entryPoint: 'vertexMain' },
      fragment: { module: displayShader, entryPoint: 'fragmentMain', targets: [{ format }] },
    });
    check();
    const displayGroup = device.createBindGroup({ layout: displayPipeline.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: shadowView }] });
    const error = await device.popErrorScope();
    check();
    if (error) throw new Error(error.message);
    function draw(t: number): void {
      const camera = cameraPosition();
      const viewProjection = multiply(reversedPerspective(canvas.width / canvas.height), lookAt(camera, cameraTarget, [0, 1, 0]));
      const azimuth = Number(azimuthControl.value) * Math.PI / 180;
      const elevation = Number(elevationControl.value) * Math.PI / 180;
      const light: Vec3 = [Math.cos(elevation) * Math.sin(azimuth), Math.sin(elevation), Math.cos(elevation) * Math.cos(azimuth)];
      const target: Vec3 = [0, 0.8, 0];
      const eye: Vec3 = [target[0] + light[0] * 10, target[1] + light[1] * 10, target[2] + light[2] * 10];
      const lightVP = multiply(reversedOrthographic(5, 1, 20), lookAt(eye, target));
      const frameData = new Float32Array(48);
      frameData.set(viewProjection, 0); frameData.set(lightVP, 16);
      frameData.set([...camera, 0], 32); frameData.set([...light, 4.0], 36);
      frameData.set([Number(pcfControl.value), Number(depthBiasControl.value), Number(normalBiasControl.value), shadowSize], 40);
      frameData.set([shadowControl.checked ? 1 : 0, 0, 0, 0], 44);
      device.queue.writeBuffer(frameBuffer, 0, frameData);
      const transforms = [identity(), model(t * 0.65, [0.5 * Math.sin(t * 0.5), 1.25 + 0.25 * Math.sin(t), 0.4 * Math.cos(t * 0.7)])];
      const materials = [[0.28, 0.32, 0.36, 0.7], [0.48, 0.16, 0.055, 0.35]];
      for (let i = 0; i < 2; i++) {
        const data = new Float32Array(20); data.set(transforms[i]); data.set(materials[i], 16);
        device.queue.writeBuffer(objectBuffers[i], 0, data);
      }
      const encoder = device.createCommandEncoder();
      // Bind only uniform groups here; never bind the shadow map as an SRV in its write pass.
      const shadowPass = encoder.beginRenderPass({ colorAttachments: [], depthStencilAttachment: {
        view: shadowView, depthClearValue: 0, depthLoadOp: 'clear', depthStoreOp: 'store',
      } });
      shadowPass.setPipeline(shadowPipeline); shadowPass.setBindGroup(0, frameGroup);
      shadowPass.setVertexBuffer(0, vertices); shadowPass.setIndexBuffer(indices, 'uint16');
      for (let i = 0; i < 2; i++) {
        shadowPass.setBindGroup(1, objectGroups[i]); shadowPass.drawIndexed(i === 0 ? 6 : 36, 1, i === 0 ? 0 : 6);
      }
      shadowPass.end();
      const preview = viewControl.value === 'shadow';
      const pass = encoder.beginRenderPass({
        colorAttachments: [{ view: activeContext.getCurrentTexture().createView(),
          clearValue: { r: 0.025, g: 0.035, b: 0.045, a: 1 }, loadOp: 'clear', storeOp: 'store' }],
        ...(preview ? {} : { depthStencilAttachment: { view: depthView, depthClearValue: 0,
          depthLoadOp: 'clear', depthStoreOp: 'store' } }),
      });
      if (preview) {
        pass.setPipeline(displayPipeline); pass.setBindGroup(0, displayGroup);
        pass.setViewport((canvas.width - canvas.height) / 2, 0, canvas.height, canvas.height, 0, 1); pass.draw(3);
      } else {
        pass.setPipeline(pipeline); pass.setBindGroup(0, frameGroup); pass.setBindGroup(2, shadowGroup);
        pass.setVertexBuffer(0, vertices); pass.setIndexBuffer(indices, 'uint16');
        for (let i = 0; i < 2; i++) {
          pass.setBindGroup(1, objectGroups[i]); pass.drawIndexed(i === 0 ? 6 : 36, 1, i === 0 ? 0 : 6);
        }
      }
      pass.end(); device.queue.submit([encoder.finish()]);
    }
    device.pushErrorScope('validation');
    draw(time);
    const drawError = await device.popErrorScope();
    check();
    if (drawError) throw new Error(drawError.message);
    await device.queue.onSubmittedWorkDone();
    check();
    detail('GPU情報', adapter.info.description || '機種名を取得できませんでした');
    detail('シーン', '床 + 回転・上下移動するCube · Lambert / GGX');
    detail('Shadow Map', `${shadowSize}×${shadowSize} depth32float · 正射影 · 単一マップ`);
    detail('深度規約', 'Camera / Shadow MapともReversed Z · clear 0 · greater');
    detail('比較', 'greater-equal · nearest比較サンプルをPCFで平均');
    return { draw, dispose };
  } catch (error) { dispose(); throw error; }
}


function redraw(): void {
  try { demo?.draw(time); updateStatus(); } catch (error) { fail(error); }
}
function tick(timestamp: number): void {
  if (!running || !demo) return;
  const delta = lastTimestamp === undefined ? 0 : Math.min((timestamp-lastTimestamp)/1000,1/30);
  lastTimestamp = timestamp; time += delta;
  try { demo.draw(time); frame = requestAnimationFrame(tick); } catch (error) { fail(error); }
}
button.addEventListener('click', async () => {
  if (busy || running) return;
  busy = true; button.disabled = true; const token = generation;
  try {
    if (!demo) {
      info.replaceChildren(); status.textContent = 'WebGPUを初期化しています';
      const initialized = await initialize(token);
      if (token !== generation) { initialized.dispose(); return; }
      demo = initialized;
    }
    busy = false; running = true; lastTimestamp = undefined;
    controls.forEach(control => { control.disabled = false; }); stop.disabled = false;
    updateCameraInteraction();
    updateStatus(); frame = requestAnimationFrame(tick);
  } catch (error) { if (token === generation) fail(error); }
});
stop.addEventListener('click', () => { pause(); updateStatus(); });
for (const control of [depthBiasControl,normalBiasControl,azimuthControl,elevationControl]) {
  control.addEventListener('input', () => { updateOutputs(); if (demo) redraw(); });
}
for (const control of [pcfControl,viewControl,shadowControl]) control.addEventListener('change', () => { updateCameraInteraction(); if (demo) redraw(); });
reset.addEventListener('click', () => {
  pcfControl.value='1'; depthBiasControl.value='0.001'; normalBiasControl.value='0.02';
  azimuthControl.value='-35'; elevationControl.value='50'; viewControl.value='scene'; shadowControl.checked=true;
  updateOutputs(); updateCameraInteraction(); if (demo) redraw();
});
document.addEventListener('visibilitychange', () => { if (document.hidden && running) { pause(); updateStatus(); } });
window.addEventListener('pagehide', () => {
  busy=false; pause(); demo?.dispose(); demo=undefined; generation++;
  button.disabled=false; button.textContent='開始'; controls.forEach(control => { control.disabled=true; });
  updateCameraInteraction();
  status.textContent='開始ボタンで再初期化します';
});
updateOutputs();

// Pointer Events cover mouse, pen and touch without an external controller library.
type PointerPosition = { x: number; y: number };
const pointers = new Map<number, PointerPosition>();
function cameraEnabled(): boolean { return demo !== undefined && viewControl.value === 'scene'; }
function clearPointers(): void {
  for (const id of [...pointers.keys()]) {
    pointers.delete(id);
    if (canvas.hasPointerCapture(id)) canvas.releasePointerCapture(id);
  }
}
function updateCameraInteraction(): void {
  const enabled = cameraEnabled();
  if (!enabled) clearPointers();
  canvas.style.touchAction = enabled ? 'none' : 'auto';
  canvas.style.cursor = enabled ? (pointers.size ? 'grabbing' : 'grab') : 'auto';
  cameraReset.disabled = !enabled;
}
function pointerDistance(): number {
  const values = [...pointers.values()];
  return values.length === 2 ? Math.hypot(values[0].x-values[1].x, values[0].y-values[1].y) : 0;
}
function zoomCamera(scale: number): void { orbit.radius = Math.max(3, Math.min(16, orbit.radius * scale)); }
canvas.addEventListener('pointerdown', event => {
  if (!cameraEnabled() || event.button !== 0 || pointers.size >= 2) return;
  pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
  canvas.setPointerCapture(event.pointerId);
  event.preventDefault(); updateCameraInteraction();
});
canvas.addEventListener('pointermove', event => {
  if (!cameraEnabled()) return;
  const previous = pointers.get(event.pointerId);
  if (!previous) return;
  const oldDistance = pointerDistance();
  pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
  if (pointers.size === 1) {
    orbit.yaw -= (event.clientX - previous.x) * 0.008;
    orbit.pitch = Math.max(-Math.PI * 85/180, Math.min(Math.PI * 85/180, orbit.pitch + (event.clientY - previous.y) * 0.008));
  } else {
    const distance = pointerDistance();
    if (oldDistance > 0 && distance > 0) zoomCamera(oldDistance / distance);
  }
  event.preventDefault(); redraw();
});
function endPointer(event: PointerEvent): void {
  pointers.delete(event.pointerId);
  if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
  updateCameraInteraction();
}
canvas.addEventListener('pointerup', endPointer);
canvas.addEventListener('pointercancel', endPointer);
canvas.addEventListener('lostpointercapture', endPointer);
canvas.addEventListener('wheel', event => {
  if (!cameraEnabled()) return;
  event.preventDefault();
  const pixels = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? canvas.clientHeight : 1);
  zoomCamera(Math.exp(Math.max(-1, Math.min(1, pixels * 0.001)))); redraw();
}, { passive: false });
cameraReset.addEventListener('click', () => { clearPointers(); orbit = { ...initialOrbit }; if (demo) redraw(); updateCameraInteraction(); });
window.addEventListener('blur', () => { clearPointers(); updateCameraInteraction(); });
updateCameraInteraction();
