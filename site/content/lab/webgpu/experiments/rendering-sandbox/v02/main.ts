import { buildCascades } from './cascaded-shadows.js';
import type { Cascade } from './cascaded-shadows.js';
import { SpecularEnvironment } from './specular-environment.js';
import { cameraFrame } from './camera-frame.js';
import { SkyDebug } from './sky-debug.js';
import { PostProcess } from './post-process.js';
import { SkyEnvironment } from './sky-environment.js';
import { lightDirection, frustumPlanes, SHADOW_RESOLUTION } from './render-math.js';
import { createOpaquePipelines, encodeOpaquePasses } from './render-passes.js';
import type { OpaqueRenderable } from './render-passes.js';
import { createTileIndices, createLayout, cascadeParameters, MAX_CANDIDATES } from './clipmap-grid.js';
import { HeightClipmap, heightLevels, terrainBound, HEIGHT_SIZE, HEIGHT_JOB_BYTES } from './height-clipmap.js';
import type { TerrainParameters } from './height-clipmap.js';
type Vec3 = [
    number,
    number,
    number
];
interface Demo {
    draw(): void;
    dispose(): void;
    regenerate(parameters: TerrainParameters): void;
}
function element<T extends Element>(selector: string, type: {
    new (): T;
}): T {
    const value = document.querySelector(selector);
    if (!(value instanceof type)) {
        throw new Error(`要素が見つかりません: ${selector}`);
    }
    return value;
}
const start = element('#gpu-start', HTMLButtonElement);
const resetCamera = element('#gpu-camera-reset', HTMLButtonElement);
const canvas = element('#gpu-canvas', HTMLCanvasElement);
// GPUの実行状態とは独立して、実寸のツールバー＋ビュー高へ設定パネルを合わせる。
// メトリクスや設定項目の展開では上限を増やさず、幅変更とズームにだけ追従する。
const inspector = element('.sandbox-inspector', HTMLElement);
const toolbar = element('.sandbox-toolbar', HTMLElement);
const workspace = element('.sandbox-workspace', HTMLElement);
inspector.tabIndex = 0;
const updateInspectorHeight = (): void => {
    const height = canvas.getBoundingClientRect().bottom - toolbar.getBoundingClientRect().top;
    workspace.style.setProperty('--inspector-height', `${Math.ceil(height)}px`);
};
const inspectorObserver = new ResizeObserver(updateInspectorHeight);
const observeInspectorLayout = (): void => {
    inspectorObserver.observe(canvas);
    inspectorObserver.observe(toolbar);
    updateInspectorHeight();
};
observeInspectorLayout();
window.addEventListener('pagehide', () => inspectorObserver.disconnect());
window.addEventListener('pageshow', observeInspectorLayout);
const status = element('#gpu-status', HTMLParagraphElement);
const info = element('#gpu-info', HTMLDListElement);
const snapGrid = element('#gpu-snap', HTMLInputElement);
const showNormals = element('#gpu-normals', HTMLInputElement);
const wireframe = element('#gpu-wireframe', HTMLInputElement);
const tileColors = element('#gpu-tile-colors', HTMLInputElement);
const heightCascades = element('#gpu-height-cascades', HTMLInputElement);
const heightGrid = element('#gpu-height-grid', HTMLInputElement);
const culling = element('#gpu-culling', HTMLInputElement);
const freeze = element('#gpu-freeze', HTMLInputElement);
const density = element('#gpu-density', HTMLSelectElement);
const radius = element('#gpu-radius', HTMLSelectElement);
const seedInput = element('#gpu-seed', HTMLInputElement);
const amplitudeInput = element('#gpu-amplitude', HTMLInputElement);
const scaleInput = element('#gpu-scale', HTMLInputElement);
const regenerate = element('#gpu-regenerate', HTMLButtonElement);
const amplitudeValue = element('#gpu-amplitude-value', HTMLOutputElement);
const scaleValue = element('#gpu-scale-value', HTMLOutputElement);
const shadows = element('#gpu-shadows', HTMLInputElement);
const ev100 = element('#gpu-ev100', HTMLInputElement);
const verticalFov = element('#gpu-fov', HTMLInputElement);
const showSkyMap = element('#gpu-sky-map', HTMLInputElement);
const aerial = element('#gpu-aerial', HTMLInputElement);
const skyIntensity = element('#gpu-sky-intensity', HTMLInputElement);
const roughness=element('#gpu-roughness',HTMLInputElement);
const metallic=element('#gpu-metallic',HTMLInputElement);
const specularIBL=element('#gpu-specular-ibl',HTMLInputElement);
const animateSun=element('#gpu-animate-sun',HTMLInputElement);
const csmColors=element('#gpu-csm-colors',HTMLInputElement);
const showSpecularMap=element('#gpu-specular-map',HTMLInputElement);
const specularMip=element('#gpu-specular-mip',HTMLInputElement);
const albedoMode = element('#gpu-albedo-mode', HTMLSelectElement);
const albedoInputs = ['r', 'g', 'b'].map(channel => element(`#gpu-albedo-${channel}`, HTMLInputElement));
const directLight = element('#gpu-direct-light', HTMLInputElement);
const shadowMask = element('#gpu-shadow-mask', HTMLInputElement);
const azimuth = element('#gpu-light-azimuth', HTMLInputElement);
const elevation = element('#gpu-light-elevation', HTMLInputElement);
const shadowWidth = element('#gpu-shadow-width', HTMLSelectElement);
const depthBias = element('#gpu-depth-bias', HTMLInputElement);
const normalBias = element('#gpu-normal-bias', HTMLInputElement);
const pcf = element('#gpu-pcf', HTMLSelectElement);
const compaction = element('#gpu-compaction', HTMLSelectElement);
const layoutControls = [snapGrid, culling, density, radius, compaction, seedInput, amplitudeInput, scaleInput, regenerate, shadows, azimuth, elevation, shadowWidth, depthBias, normalBias, pcf];
const speed = element('#gpu-speed', HTMLInputElement);
const speedValue = element('#gpu-speed-value', HTMLOutputElement);
const cameraValue = element('#gpu-camera-value', HTMLOutputElement);
const initialCamera = { yaw: 0.55, pitch: 0 };
function defaultCamera(): {
    yaw: number;
    pitch: number;
    position: Vec3;
} {
    return {
        ...initialCamera,
        position: [0, 200, 0]
    };
}
let camera = defaultCamera(), generation = 0, busy = false, frame = 0, lastTime = 0;
let animatedAzimuth=Number(azimuth.value);
const keys = new Set<string>();
const movementKeys = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE']);
const lookKeys = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown']);
canvas.tabIndex = 0;
canvas.setAttribute('aria-label', '地形ビュー。WASDで移動、Q/Eで下降・上昇、矢印キーまたはドラッグで視点回転');
let demo: Demo | undefined, controller: AbortController | undefined;
const pointers = new Map<number, {
    x: number;
    y: number;
}>();
function normalize(v: Vec3): Vec3 { const length = Math.hypot(...v); return [v[0] / length, v[1] / length, v[2] / length]; }
function cross(a: Vec3, b: Vec3): Vec3 { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
function dot(a: Vec3, b: Vec3): number { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
function viewProjection(fov: number): Float32Array<ArrayBuffer> {
    const z: Vec3 = [Math.sin(camera.yaw) * Math.cos(camera.pitch), Math.sin(camera.pitch), Math.cos(camera.yaw) * Math.cos(camera.pitch)];
    const x = normalize(cross([0, 1, 0], z)), y = cross(z, x);
    const eye = camera.position;
    const f = 1 / Math.tan(fov / 2), sx = f / (canvas.width / canvas.height);
    // 右手系のビュー。NDCのZ=near/距離とし、near=1、far=無限遠のReversed Zを使う。
    return new Float32Array([x[0] * sx, y[0] * f, 0, -z[0], x[1] * sx, y[1] * f, 0, -z[1],
        x[2] * sx, y[2] * f, 0, -z[2], -dot(x, eye) * sx, -dot(y, eye) * f, 1, dot(z, eye)]);
}
async function bytes(name: string, signal: AbortSignal): Promise<ArrayBuffer> {
    const response = await fetch(new URL(name, import.meta.url), { signal, cache: 'no-cache' });
    if (!response.ok) {
        throw new Error(`${name}: HTTP ${response.status}`);
    }
    return response.arrayBuffer();
}
function utf8(data: ArrayBuffer, name: string): string {
    const b = new Uint8Array(data);
    if (b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf) {
        throw new Error(`${name}: UTF-8 BOMは使用できません`);
    }
    try {
        return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(data);
    }
    catch {
        throw new Error(`${name}: 不正なUTF-8です`);
    }
}
function terrainParameters(): TerrainParameters {
    const seed = Number(seedInput.value);
    const amplitude = Number(amplitudeInput.value);
    const scale = Number(scaleInput.value);
    if (seedInput.value.trim() === '' || !Number.isInteger(seed) || seed < 0 || seed > 4294967295
        || !Number.isFinite(amplitude) || amplitude < 100 || amplitude > 2000
        || !Number.isFinite(scale) || scale < 500 || scale > 8000) {
        throw new Error('地形パラメータが範囲外です。シードはuint32の整数で指定してください');
    }
    return { seed, amplitude, scale };
}
function detail(parent: HTMLDListElement, label: string, value: string): HTMLElement {
    const dt = document.createElement('dt'), dd = document.createElement('dd');
    dt.textContent = label;
    dd.textContent = value;
    parent.append(dt, dd);
    return dd;
}
// ローカル地形のY=0を海抜2,000mに置き、負の標高も地球表面より上に収める。
const ATMOSPHERE_REFERENCE_ALTITUDE = 2000;

// 動的な数値を先に見せ、構成・資源は必要なときだけ展開できるように分離する。
function metricGroups(): { activity: HTMLDListElement; configuration: HTMLDListElement } {
    const heading = document.createElement('dt');
    heading.textContent = '実行状況';
    heading.style.fontWeight = 'bold';
    const activityBody = document.createElement('dd');
    const activity = document.createElement('dl');
    activityBody.append(activity);
    const configHeading = document.createElement('dt');
    configHeading.textContent = '構成情報';
    configHeading.style.fontWeight = 'bold';
    const configBody = document.createElement('dd');
    const disclosure = document.createElement('details');
    const summary = document.createElement('summary');
    summary.textContent = '設定とGPUリソースを表示';
    summary.style.cursor = 'pointer';
    const configuration = document.createElement('dl');
    disclosure.append(summary, configuration);
    configBody.append(disclosure);
    info.replaceChildren(heading, activityBody, configHeading, configBody);
    return { activity, configuration };
}
function updateDetail(node: HTMLElement, value: string): void {
    // カメラ移動中も、変わっていない構成情報のDOMは書き換えない。
    if (node.textContent !== value) { node.textContent = value; }
}
function clearPointers(): void {
    for (const id of [...pointers.keys()]) {
        pointers.delete(id);
        if (canvas.hasPointerCapture(id)) {
            canvas.releasePointerCapture(id);
        }
    }
    canvas.style.cursor = demo ? 'grab' : 'auto';
}
function release(): void {
    cancelAnimationFrame(frame);
    frame = 0;
    keys.clear();
    lastTime = 0;
    controller?.abort();
    controller = undefined;
    clearPointers();
    demo?.dispose();
    demo = undefined;
    freeze.checked = false;
    layoutControls.forEach(c => { c.disabled = false; });
    generation++;
    busy = false;
    resetCamera.disabled = true;
    regenerate.disabled = true;
    canvas.style.touchAction = 'auto';
    canvas.style.cursor = 'auto';
    start.disabled = false;
    start.textContent = '実行';
}
function fail(error: unknown): void { release(); status.textContent = `実行できませんでした: ${error instanceof Error ? error.message : String(error)}`; }
function updateCameraReadout(): void {
    cameraValue.value = `X ${camera.position[0].toFixed(1)} / Y ${camera.position[1].toFixed(1)} / Z ${camera.position[2].toFixed(1)} m`;
}
function moveCamera(forward: number, right: number, up: number, distance: number): void {
    const cp = Math.cos(camera.pitch), sp = Math.sin(camera.pitch), sy = Math.sin(camera.yaw), cy = Math.cos(camera.yaw);
    camera.position[0] += (-sy * cp * forward + cy * right) * distance;
    camera.position[1] += (-sp * forward + up) * distance;
    camera.position[2] += (-cy * cp * forward - sy * right) * distance;
}
function scheduleDraw(): void {
    if (!demo || frame || document.hidden) {
        return;
    }
    frame = requestAnimationFrame(tick);
}
function tick(time: number): void {
    frame = 0;
    if (!demo || document.hidden) {
        return;
    }
    const dt = lastTime ? Math.min((time - lastTime) / 1000, 0.05) : 0;
    lastTime = time;
    if(animateSun.checked && !freeze.checked) { animatedAzimuth=(animatedAzimuth+dt*3)%360;azimuth.value=String(animatedAzimuth);element('#gpu-light-azimuth-value',HTMLOutputElement).value=animatedAzimuth.toFixed(1)+'°'; }
    const pressed = (code: string): number => Number(keys.has(code));
    const forward = pressed('KeyW') - pressed('KeyS'), right = pressed('KeyD') - pressed('KeyA'), up = pressed('KeyE') - pressed('KeyQ');
    const length = Math.hypot(forward, right, up);
    if (length) {
        moveCamera(forward / length, right / length, up / length, Number(speed.value) * (keys.has('ShiftLeft') || keys.has('ShiftRight') ? 4 : 1) * dt);
    }
    camera.yaw += (pressed('ArrowLeft') - pressed('ArrowRight')) * dt;
    camera.pitch = Math.max(-1.54, Math.min(1.54, camera.pitch + (pressed('ArrowDown') - pressed('ArrowUp')) * dt));
    try {
        demo.draw();
        updateCameraReadout();
    }
    catch (error) {
        fail(error);
        return;
    }
    if ((animateSun.checked && !freeze.checked) || [...keys].some(code => movementKeys.has(code) || lookKeys.has(code))) {
        scheduleDraw();
    }
    else {
        lastTime = 0;
    }
}
async function initialize(token: number, signal: AbortSignal): Promise<Demo> {
    const check = (): void => {
        if (token !== generation || signal.aborted) {
            throw new Error('初期化を中断しました');
        }
    };
    if (!window.isSecureContext || !navigator.gpu) {
        throw new Error('WebGPU対応ブラウザでHTTPSまたはlocalhostから開いてください');
    }
    let parameters = terrainParameters();
    status.textContent = 'GPUとプロシージャル地形を初期化しています';
    const adapter = await navigator.gpu.requestAdapter();
    check();
    if (!adapter) {
        throw new Error('GPUアダプターを取得できませんでした');
    }
    const hasSubgroups = adapter.features.has('subgroups');
    const device = await adapter.requestDevice({ requiredFeatures: hasSubgroups ? ['subgroups'] : [] });
    let context: GPUCanvasContext | null = null;
    let depth: GPUTexture | undefined;
    let hdrColor: GPUTexture | undefined;
    let shadowDepth: GPUTexture | undefined;
    let cache: HeightClipmap | undefined;
    let skyEnvironment: SkyEnvironment | undefined;
    let specularEnvironment:SpecularEnvironment|undefined;
    const debugResources:SkyDebug[]=[];
    let disposed = false;
    const buffers: GPUBuffer[] = [];
    const retired = new Set<HeightClipmap>();
    function dispose(): void {
        if (disposed) {
            return;
        }
        disposed = true;
        if (token === generation) {
            context?.unconfigure();
        }
        cache?.dispose();
        skyEnvironment?.dispose();
        specularEnvironment?.dispose();
        debugResources.forEach(debug=>debug.dispose());
        retired.forEach(old => old.dispose());
        buffers.forEach(buffer => buffer.destroy());
        depth?.destroy();
        hdrColor?.destroy();
        shadowDepth?.destroy();
        device.destroy();
    }
    try {
        check();
        void device.lost.then(({ reason, message }) => {
            if (!disposed && token === generation && reason !== 'destroyed') {
                fail(new Error(`GPUデバイスを失いました: ${message || reason}`));
            }
        });
        device.addEventListener('uncapturederror', event => {
            if (!disposed && token === generation) {
                fail(event.error);
            }
        });
        context = canvas.getContext('webgpu');
        if (!context) {
            throw new Error('WebGPU Canvasを取得できませんでした');
        }
        const activeContext = context;
        const format = navigator.gpu.getPreferredCanvasFormat();
        activeContext.configure({ device, format, alphaMode: 'opaque' });
        const common = utf8(await bytes('tile-common.wgsl', signal), 'tile-common.wgsl');
        async function shader(name: string, library = '', directive = '', includeScene = true): Promise<GPUShaderModule> {
            const code = directive + (includeScene ? common : '') + '\n' + library + '\n' + utf8(await bytes(name, signal), name);
            check();
            device.pushErrorScope('validation');
            const module = device.createShaderModule({ code, label: name });
            const compilation = await module.getCompilationInfo();
            const error = await device.popErrorScope();
            check();
            const messages = compilation.messages.filter(message => message.type === 'error');
            if (error || messages.length > 0) {
                throw new Error(`${name}: ${messages.map(message => `${message.lineNum}: ${message.message}`).join('; ') || error?.message}`);
            }
            return module;
        }
        const cameraLibrary = utf8(await bytes('camera.wgsl', signal), 'camera.wgsl');
        const geometryLibrary = utf8(await bytes('terrain-geometry.wgsl', signal), 'terrain-geometry.wgsl');
        const atmosphereLibrary = utf8(await bytes('atmosphere.wgsl', signal), 'atmosphere.wgsl');
        const skyLibrary = atmosphereLibrary + utf8(await bytes('sky-common.wgsl', signal), 'sky-common.wgsl');
        const octahedralLibrary = utf8(await bytes('sky-octahedral.wgsl', signal), 'sky-octahedral.wgsl');
        const shLibrary = utf8(await bytes('sky-sh.wgsl', signal), 'sky-sh.wgsl');
        const pbrLibrary=utf8(await bytes('pbr.wgsl',signal),'pbr.wgsl');
        const samplingLibrary=utf8(await bytes('ibl-sampling.wgsl',signal),'ibl-sampling.wgsl');
        const prefilterShader=await shader('ibl-prefilter.wgsl',pbrLibrary+samplingLibrary+octahedralLibrary,'',false);
        const brdfShader=await shader('ibl-brdf.wgsl',pbrLibrary+samplingLibrary,'',false);
        const renderShader = await shader('terrain-forward.wgsl', geometryLibrary + shLibrary + atmosphereLibrary + cameraLibrary+pbrLibrary+octahedralLibrary);
        const skyGenerate = await shader('sky-generate.wgsl', skyLibrary + octahedralLibrary, '', false);
        const skyProject = await shader('sky-project.wgsl', octahedralLibrary + shLibrary, '', false);
        const skyReduce = await shader('sky-reduce.wgsl', shLibrary, '', false);
        const skyRender = await shader('sky-render.wgsl', skyLibrary + cameraLibrary, '', false);
        const skyDebugShader = await shader('sky-debug.wgsl', cameraLibrary, '', false);
        const postShader = await shader('post-process.wgsl', '', '', false);
        const depthShader = await shader('terrain-zonly.wgsl', geometryLibrary);
        const heightShader = await shader('generate-height.wgsl', '', '', false);
        const cullLibrary = utf8(await bytes('cull.wgsl', signal), 'cull.wgsl');
        const workgroupShader = await shader('compact-workgroup.wgsl', cullLibrary);
        const subgroupShader = hasSubgroups ? await shader('compact-subgroup.wgsl', cullLibrary, 'enable subgroups;\n') : undefined;
        const grid = createTileIndices();
        device.pushErrorScope('validation');
        function buffer(size: number, usage: GPUBufferUsageFlags, mappedAtCreation = false): GPUBuffer {
            const result = device.createBuffer({ size, usage, mappedAtCreation });
            buffers.push(result);
            return result;
        }
        function indexBuffer(data: Uint16Array<ArrayBuffer>): GPUBuffer {
            const result = buffer(data.byteLength, GPUBufferUsage.INDEX, true);
            new Uint16Array(result.getMappedRange()).set(data);
            result.unmap();
            return result;
        }
        const indices = indexBuffer(grid.surface);
        const wireIndices = indexBuffer(grid.wire);
        // メインとシャドウは独立したUniform・可視リスト・Indirect引数を所有する。
        // 候補タイルと標高は共有するが、メイン不可視のキャスターも光源視点で残す。
        function createView(label: string) {
            const uniform = buffer(752, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST);
            const visible = buffer(MAX_CANDIDATES * 4, GPUBufferUsage.STORAGE);
            const indirect = buffer(20, GPUBufferUsage.STORAGE | GPUBufferUsage.INDIRECT | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC);
            uniform.label = label + ' Scene';
            visible.label = label + ' 可視タイル';
            indirect.label = label + ' Indirect';
            device.queue.writeBuffer(indirect, 0, new Uint32Array([grid.surface.length, 0, 0, 0, 0]));
            return { uniform, visible, indirect, settings: new Float32Array(188) };
        }
        const mainView = createView('Main');
        const shadowViews=Array.from({length:4},(_,i)=>createView(`CSM ${i}`));
        const wireIndirect = buffer(20, GPUBufferUsage.INDIRECT | GPUBufferUsage.COPY_DST);
        device.queue.writeBuffer(wireIndirect, 0, new Uint32Array([grid.wire.length, 0, 0, 0, 0]));
        const readback = buffer(100, GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST);
        // 標高生成だけは矩形ごとのUniformを動的オフセットで参照する。
        // 生成先は標高のFP16ペアだけで、元DEMや一時的なFloat32標高面を持たない。
        const heightLayout = device.createBindGroupLayout({ entries: [
                { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform', hasDynamicOffset: true, minBindingSize: HEIGHT_JOB_BYTES } },
                { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } }
            ] });
        const heightPipeline = await device.createComputePipelineAsync({
            layout: device.createPipelineLayout({ bindGroupLayouts: [heightLayout] }),
            compute: { module: heightShader, entryPoint: 'generateMain' }
        });
        const computeLayout = device.createBindGroupLayout({ entries: [
                { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
                { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
                { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } }
            ] });
        const computePipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [computeLayout] });
        const workgroupCompute = await device.createComputePipelineAsync({ layout: computePipelineLayout, compute: { module: workgroupShader, entryPoint: 'cullMain' } });
        const subgroupCompute = subgroupShader ? await device.createComputePipelineAsync({ layout: computePipelineLayout, compute: { module: subgroupShader, entryPoint: 'cullMain' } }) : undefined;
        function computeGroup(view: ReturnType<typeof createView>): GPUBindGroup {
            return device.createBindGroup({ layout: computeLayout, entries: [
                { binding: 0, resource: { buffer: view.uniform } },
                { binding: 1, resource: { buffer: view.visible } },
                { binding: 2, resource: { buffer: view.indirect } }
            ] });
        }
        const mainComputeGroup = computeGroup(mainView);
        const shadowComputeGroups=shadowViews.map(computeGroup);
        const groupLayout = device.createBindGroupLayout({ entries: [
                { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
                { binding: 1, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
                { binding: 2, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } }
            ] });
        const cameraBuffer = buffer(16, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST);
        const environment = await SkyEnvironment.create(device, { generate: skyGenerate, project: skyProject, reduce: skyReduce, render: skyRender }, 'rgba16float', cameraBuffer);
        skyEnvironment = environment;
        check();
        const skyDebug = await SkyDebug.create(device, skyDebugShader, environment.map.createView(), cameraBuffer);
        debugResources.push(skyDebug);
        const specular=await SpecularEnvironment.create(device,prefilterShader,brdfShader,environment.map.createView());
        specularEnvironment=specular;check();
        const specularDebug=await SkyDebug.create(device,skyDebugShader,specular.map.createView(),cameraBuffer);
        debugResources.push(specularDebug);check();
        const lightingBuffer = buffer(464, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST);
        shadowDepth = device.createTexture({ label: 'Directional Shadow Map', size: [SHADOW_RESOLUTION, SHADOW_RESOLUTION],
            format: 'depth32float', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING });
        const shadowDepthView = shadowDepth.createView();
        const lightingLayout = device.createBindGroupLayout({ entries: [
            { binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
            { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'depth' } },
            { binding: 2, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'comparison' } },
            { binding: 3, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
            { binding: 4, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
            {binding:5,visibility:GPUShaderStage.FRAGMENT,texture:{sampleType:'float'}},
            {binding:6,visibility:GPUShaderStage.FRAGMENT,texture:{sampleType:'float'}},
            {binding:7,visibility:GPUShaderStage.FRAGMENT,sampler:{type:'filtering'}}
        ] });
        const lightingGroup = device.createBindGroup({ layout: lightingLayout, entries: [
            { binding: 0, resource: { buffer: lightingBuffer } },
            { binding: 1, resource: shadowDepthView },
            { binding: 2, resource: device.createSampler({ compare: 'greater-equal', minFilter: 'linear', magFilter: 'linear' }) },
            { binding: 3, resource: { buffer: environment.coefficients } },
            { binding: 4, resource: { buffer: cameraBuffer } },
            {binding:5,resource:specular.map.createView()},
            {binding:6,resource:specular.lut.createView()},
            {binding:7,resource:specular.sampler}
        ] });
        const pipelines = await createOpaquePipelines(device, groupLayout, lightingLayout, depthShader, renderShader, 'rgba16float');
        check();
        let layout = createLayout(Number(density.value), Number(radius.value));
        let origins = cascadeParameters(camera.position[0], camera.position[2], layout, snapGrid.checked);
        let mainGroup: GPUBindGroup;
        let shadowGroups:GPUBindGroup[];
        function replaceCache(count: number): HeightClipmap {
            const previous = cache;
            const next = new HeightClipmap(device, heightPipeline, count, parameters);
            cache = next;
            function geometryGroup(view: ReturnType<typeof createView>): GPUBindGroup {
                return device.createBindGroup({ layout: groupLayout, entries: [
                    { binding: 0, resource: { buffer: view.uniform } },
                    { binding: 1, resource: { buffer: next.buffer } },
                    { binding: 2, resource: { buffer: view.visible } }
                ] });
            }
            mainGroup = geometryGroup(mainView);
            shadowGroups = shadowViews.map(geometryGroup);
            if (previous) {
                // UIで段数を変えたときだけ再確保する。古い描画の完了後に旧資源を破棄する。
                retired.add(previous);
                void device.queue.onSubmittedWorkDone().then(() => {
                    previous.dispose();
                    retired.delete(previous);
                }).catch(() => { previous.dispose(); retired.delete(previous); });
            }
            return next;
        }
        replaceCache(heightLevels(layout.levels));
        depth = device.createTexture({ size: [canvas.width, canvas.height], format: 'depth32float', usage: GPUTextureUsage.RENDER_ATTACHMENT });
        const depthView = depth.createView();
        // Canvasと同サイズのシーンリニアHDR。全シェーディングはここへ書く。
        hdrColor = device.createTexture({ label: 'Scene HDR Linear', size: [canvas.width, canvas.height],
            format: 'rgba16float', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING });
        const hdrView = hdrColor.createView();
        const display = await PostProcess.create(device, postShader, hdrView, format);
        check();
        // 将来のモデルも同じOpaqueRenderable契約へ追加する。位置用・色用のシェーダーを分ける。
        const terrain: OpaqueRenderable = {
            drawDepth(pass, view) {
                pass.setPipeline(pipelines.zOnly);
                pass.setBindGroup(0, view === 'main' ? mainGroup : shadowGroups[view]);
                pass.setIndexBuffer(indices, 'uint16');
                pass.drawIndexedIndirect(view === 'main' ? mainView.indirect : shadowViews[view].indirect, 0);
            },
            drawForward(pass) {
                pass.setPipeline(pipelines.forward);
                pass.setBindGroup(0, mainGroup);
                pass.setBindGroup(1, lightingGroup);
                pass.setIndexBuffer(indices, 'uint16');
                pass.drawIndexedIndirect(mainView.indirect, 0);
            },
            drawDebug(pass) {
                pass.setPipeline(pipelines.wire);
                pass.setBindGroup(1, lightingGroup);
                pass.setBindGroup(0, mainGroup);
                pass.setIndexBuffer(wireIndices, 'uint16');
                pass.drawIndexedIndirect(wireIndirect, 0);
            }
        };
        const renderables: readonly OpaqueRenderable[] = [terrain];
        let cascades:Cascade[]=[];
        const csmView=new Float32Array(4);
        let lightMatrix = new Float32Array(16);
        let renderPending=false,redrawQueued=false;
        let light = lightDirection(animateSun.checked?animatedAzimuth:Number(azimuth.value), Number(elevation.value));
        let previousPreExposure = 1;
        let updates = 0;
        let pending = false;
        const { activity, configuration } = metricGroups();
        const heightInfo = detail(configuration, 'Height Clipmap', '');
        const heightUpdateInfo = detail(activity, '標高生成', '');
        const skyUpdateInfo = detail(activity, '天球・SH更新', '');
        const generationInfo = detail(configuration, '地形', '');
        detail(configuration, '共有タイル', `${grid.vertexCount.toLocaleString()}頂点ID / ${(grid.surface.length / 3).toLocaleString()}三角形 / VB 0 B`);
        detail(configuration, 'HDRカラー', `rgba16float / ${canvas.width}×${canvas.height} / ${(canvas.width * canvas.height * 8 / 1048576).toFixed(2)} MiB / PostProcessPassで表示変換`);
        detail(configuration, 'タイル共有IB', `uint16 / タイル描画 ${indices.size.toLocaleString()} B + ワイヤーフレーム ${wireIndices.size.toLocaleString()} B`);
        detail(configuration, 'GPU描画データ', '可視タイル 6,400 B×5 / Scene 752 B×5 / Lighting 464 B / Camera 16 B / 読戻し100 B');
        detail(configuration, '天球リソース', 'Sky 256² 512 KiB / GGX 256²〜16²・5 Mip 約682 KiB / BRDF LUT 128² 128 KiB / SH 9係数');
        detail(configuration, '描画Pass', 'ZPrePass → ShadowPass → ForwardShadingPass（HDR・Equal）→ PostProcessPass（ACES Filmic・sRGB）');
        const shadowInfo = detail(configuration, 'Shadow Map', '');
        const skyInfo = detail(configuration, 'SkyLight Diffuse', '');
        const compactInfo = detail(configuration, '可視リスト集約', '');
        const layoutInfo = detail(configuration, 'メッシュLOD', '');
        const mainCountInfo = detail(activity, 'Main 可視タイル', 'GPU結果を取得中');
        const shadowCountInfo = detail(activity, 'Shadow 可視タイル', 'GPU結果を取得中');
        const updateInfo = detail(activity, '配置・カリング更新', '');
        detail(configuration, 'GPU', adapter.info.description || adapter.info.device || 'ブラウザから機種名は提供されていません');
        function draw(): void {
            if(disposed) { return; }
            if(renderPending) { redrawQueued=true;return; }
            const frameCamera = cameraFrame(Number(ev100.value), Number(verticalFov.value), previousPreExposure);
            device.queue.writeBuffer(cameraBuffer, 0, frameCamera.uniform);
            const matrix = viewProjection(frameCamera.verticalFov);
            const live = !freeze.checked || updates === 0;
            const encoder = device.createCommandEncoder({ label: 'RenderingSandbox Frame' });
            if (live) {
                layout = createLayout(Number(density.value), Number(radius.value));
                origins = cascadeParameters(camera.position[0], camera.position[2], layout, snapGrid.checked);
                const needed = heightLevels(layout.levels);
                if (!cache || cache.count !== needed) { replaceCache(needed); }
                light = lightDirection(animateSun.checked?animatedAzimuth:Number(azimuth.value), Number(elevation.value));
                // 光源の深度範囲には現在の候補地形全体を保守的に含める。
                // XYの投影範囲は独立して狭く取り、画面外のキャスターもこの範囲で判定する。
                cascades=buildCascades(camera.position,camera.yaw,camera.pitch,frameCamera.verticalFov,canvas.width/canvas.height,
                    light,Number(shadowWidth.value),Math.SQRT2*layout.radius+terrainBound(parameters)+16);
                lightMatrix=cascades[0].matrix;
                const forward=normalize([-Math.sin(camera.yaw)*Math.cos(camera.pitch),-Math.sin(camera.pitch),-Math.cos(camera.yaw)*Math.cos(camera.pitch)]);
                // フリーズ中はカスケード選択の基準視点も保持し、観察用カメラだけを動かす。
                csmView.set([...forward,-dot(forward,camera.position)]);
                mainView.settings.set(frustumPlanes(matrix),16);
                shadowViews.forEach((view,i)=>{
                    view.settings.set(frustumPlanes(cascades[i].matrix),16);
                    view.settings.fill(0,120);view.settings.set(cascades[i].planes,120);
                    new Uint32Array(view.settings.buffer)[184]=cascades[i].planes.length/4;
                });
            }
            const skyChanged = environment.encode(encoder, light, camera.yaw, camera.pitch, canvas.width / canvas.height, Math.max(camera.position[1] + ATMOSPHERE_REFERENCE_ALTITUDE, 2), frameCamera.verticalFov);
            specular.encode(encoder,skyChanged);
            updateDetail(skyUpdateInfo, `#${environment.revision} / ${skyChanged ? 'Sky・SH・GGX全Mip更新' : '保持'}`);
            const activeCache = cache;
            if (!activeCache) {
                throw new Error('Height Clipmapが初期化されていません');
            }
            if (live) {
                const stats = activeCache.encode(encoder, camera.position[0], camera.position[2]);
                updateDetail(heightUpdateInfo, `${stats.levels}段 / ${stats.samples.toLocaleString()}サンプル / ${stats.rectangles}矩形（前回の描画で更新）`);
            }
            const bound = terrainBound(parameters);
            function uploadView(view: ReturnType<typeof createView>, projection: Float32Array, height: HeightClipmap): void {
                const settings = view.settings;
                settings.set(projection);
                settings.set([...light, 0], 40);
                settings.set([-bound, 1 / (2 * bound), Number(showNormals.checked), Number(tileColors.checked)], 44);
                settings.set([HEIGHT_SIZE, height.count, 1, Number(heightCascades.checked)], 48);
                settings.set([0, -bound, bound, Number(heightGrid.checked)], 52);
                new Uint32Array(settings.buffer).set([layout.density, layout.levels, layout.count, Number(culling.checked)], 56);
                settings.set(origins, 60);
                new Int32Array(settings.buffer).set(height.windows, 92);
                device.queue.writeBuffer(view.uniform, 0, settings);
            }
            // 2つの別バッファへ転送する。同じUniformを書き換えて2 dispatchを発行しない。
            uploadView(mainView, matrix, activeCache);
            shadowViews.forEach((view,i)=>uploadView(view,cascades[i].matrix,activeCache));
            const lighting = new Float32Array(116);
            lighting.set(lightMatrix);
            lighting.set([...light, directLight.checked ? 20.0 : 0.0], 16);
            lighting.set([Number(shadows.checked), Number(depthBias.value), Number(normalBias.value), 1 / SHADOW_RESOLUTION], 20);
            lighting.set([Number(pcf.value), Number(shadowMask.checked), 0, 0], 24);
            // 材質変更は照明用Uniformだけに反映し、地形と天空の再生成は行わない。
            lighting.set([...albedoInputs.map(input => Number(input.value)), Number(skyIntensity.value)], 28);
            lighting.set([...camera.position, 0], 32);
            lighting.set([Number(aerial.checked), ATMOSPHERE_REFERENCE_ALTITUDE, Number(albedoMode.value === 'constant'), 0], 36);
            cascades.forEach((cascade,i)=>lighting.set(cascade.matrix,40+i*16));
            lighting.set(cascades.map(c=>c.split),104);
            lighting.set(csmView,108);
            lighting.set([Number(roughness.value),Number(metallic.value),Number(specularIBL.checked),Number(csmColors.checked)],112);
            device.queue.writeBuffer(lightingBuffer, 0, lighting);
            if (live) {
                const compute = compaction.value === 'auto' && subgroupCompute ? subgroupCompute : workgroupCompute;
                updateDetail(compactInfo, compute === subgroupCompute ? 'subgroup集約 / 非空subgroupごとに1 AtomicAdd' : 'workgroup共有メモリscan / 非空workgroupごとに1 AtomicAdd');
                encoder.clearBuffer(mainView.indirect, 4, 4);
                shadowViews.forEach(view=>encoder.clearBuffer(view.indirect,4,4));
                const pass = encoder.beginComputePass({ label: 'Main/Shadow フラスタムカリング' });
                pass.setPipeline(compute);
                pass.setBindGroup(0, mainComputeGroup);
                pass.dispatchWorkgroups(Math.ceil(layout.count / 64));
                if (shadows.checked) {
                    for(const group of shadowComputeGroups) { pass.setBindGroup(0,group);pass.dispatchWorkgroups(Math.ceil(layout.count/64)); }
                }
                pass.end();
                encoder.copyBufferToBuffer(mainView.indirect, 4, wireIndirect, 4, 4);
                updates++;
            }
            encodeOpaquePasses(encoder, hdrView, depthView, shadowDepthView,
                renderables, shadows.checked, wireframe.checked, environment);
            if (showSkyMap.checked) { skyDebug.encode(encoder, hdrView, canvas.width, canvas.height); }
            if(showSpecularMap.checked) { specularDebug.encode(encoder,hdrView,canvas.width,canvas.height,Number(specularMip.value),showSkyMap.checked?1:0); }
            display.encode(encoder, activeContext.getCurrentTexture().createView());
            // 状態表示だけを非同期に読む。標高・可視数のCPU取得を待って描画する経路はない。
            const read = !pending;
            const revision = updates;
            const candidates = layout.count;
            if (read) {
                pending = true;
                encoder.copyBufferToBuffer(mainView.indirect, 0, readback, 0, 20);
                shadowViews.forEach((view,i)=>encoder.copyBufferToBuffer(view.indirect,0,readback,20+i*20,20));
            }
            device.queue.submit([encoder.finish()]);
            // 動的天空の更新がGPUより先行し続けないよう、フレームの投入数を1つに制限する。
            renderPending=true;
            void device.queue.onSubmittedWorkDone().then(()=>{renderPending=false;if(redrawQueued || (animateSun.checked&&!freeze.checked)){redrawQueued=false;scheduleDraw();}}).catch(()=>{renderPending=false;});
            previousPreExposure = frameCamera.preExposure;
            if (read) {
                void readback.mapAsync(GPUMapMode.READ).then(() => {
                    const values = new Uint32Array(readback.getMappedRange());
                    const count = values[1];
                    const shadowCounts=shadowViews.map((_,i)=>values[6+i*5]);
                    const shadowCount=shadowCounts.join('/');
                    readback.unmap();
                    pending = false;
                    if (!disposed && revision === updates) {
                        updateDetail(mainCountInfo, `${count} / 候補 ${candidates} タイル`);
                        updateDetail(shadowCountInfo, shadows.checked ? `${shadowCount} / 候補 ${candidates} タイル` : 'OFF（描画なし）');
                    }
                    else if (!disposed) {
                        scheduleDraw();
                    }
                }).catch(error => { pending = false; if (!disposed && token === generation) {
                    fail(error);
                } });
            }
            updateDetail(heightInfo, `1024×1024 × ${activeCache.count}段 / FP16 ${(activeCache.bytes / 1048576).toFixed(0)} MiB / 間隔 ${Array.from({ length: activeCache.count }, (_, l) => 2 ** l).join('・')} m`);
            updateDetail(generationInfo, `seed ${parameters.seed} / 振幅 ${parameters.amplitude} m / 山スケール ${parameters.scale} m / 高周波は標高段ごとに除去`);
            updateDetail(layoutInfo, `${layout.levels}段 / セル ${layout.steps.join('・')} m / 半径 ${radius.value} m / 外周半幅 ${layout.radius} m`);
            updateDetail(skyInfo, `地球・単一散乱 / 観測高度 ${(Math.max(camera.position[1] + ATMOSPHERE_REFERENCE_ALTITUDE, 2)).toFixed(0)} m / 2次SH / 強度 ${skyIntensity.value}`);
            updateDetail(shadowInfo, `2048² Atlas / 1024²×4 / 16 MiB / 距離 ${shadowWidth.value}m / Reversed Z / ${shadows.checked ? 'ON' : 'OFF'}`);
            updateDetail(updateInfo, `#${updates} / ${freeze.checked ? 'フリーズ中（標高キャッシュも固定）' : 'カメラ追従中'}`);
        }
        status.textContent = 'FP16 Height ClipmapをComputeで生成しています';
        draw();
        const validation = await device.popErrorScope();
        check();
        if (validation) {
            throw new Error(validation.message);
        }
        await device.queue.onSubmittedWorkDone();
        check();
        return { draw, dispose, regenerate: next => {
                parameters = next;
                cache?.regenerate(next);
            } };
    }
    catch (error) {
        dispose();
        throw error;
    }
}
start.addEventListener('click', async () => {
    if (busy) {
        return;
    }
    release();
    busy = true;
    start.disabled = true;
    camera = defaultCamera();
    info.replaceChildren();
    controller = new AbortController();
    const signal = controller.signal, token = generation;
    try {
        const initialized = await initialize(token, signal);
        if (token !== generation) {
            initialized.dispose();
            return;
        }
        demo = initialized;
        busy = false;
        start.disabled = false;
        start.textContent = '再読み込み';
        resetCamera.disabled = false;
        regenerate.disabled = false;
        canvas.style.touchAction = 'none';
        canvas.style.cursor = 'grab';
        status.textContent = '描画済み / 地形ビューをクリックしてWASDで移動';
        if(animateSun.checked) { scheduleDraw(); }
        updateCameraReadout();
    }
    catch (error) {
        if (token === generation) {
            fail(error);
        }
    }
});
resetCamera.addEventListener('click', () => { clearInput(); camera = defaultCamera(); scheduleDraw(); });
for (const control of [wireframe, snapGrid, showNormals, tileColors, culling, density, radius, compaction, shadows, shadowMask, azimuth, elevation, shadowWidth, depthBias, normalBias, pcf, aerial, showSkyMap, directLight, heightCascades, heightGrid, specularIBL, animateSun, csmColors, showSpecularMap]) {
    control.addEventListener('change', scheduleDraw);
}
animateSun.addEventListener('change',()=>{animatedAzimuth=Number(azimuth.value);});
azimuth.addEventListener('input',()=>{animatedAzimuth=Number(azimuth.value);});
albedoMode.addEventListener('change', () => { albedoInputs.forEach(input => { input.disabled = albedoMode.value !== 'constant'; }); scheduleDraw(); });
freeze.addEventListener('change', () => { layoutControls.forEach(c => { c.disabled = freeze.checked; }); scheduleDraw(); });
speed.addEventListener('input', () => { speedValue.value = `${speed.value} m/s`; });
function clearInput(): void { keys.clear(); lastTime = 0; clearPointers(); }
canvas.addEventListener('keydown', event => {
    if (!demo || event.ctrlKey || event.metaKey || event.altKey) {
        return;
    }
    if (movementKeys.has(event.code) || lookKeys.has(event.code) || event.code === 'ShiftLeft' || event.code === 'ShiftRight') {
        event.preventDefault();
        keys.add(event.code);
        scheduleDraw();
    }
});
window.addEventListener('keyup', event => { keys.delete(event.code); });
canvas.addEventListener('blur', clearInput);
canvas.addEventListener('pointerdown', event => {
    if (!demo || event.button !== 0 || pointers.size) {
        return;
    }
    canvas.focus({ preventScroll: true });
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    canvas.setPointerCapture(event.pointerId);
    canvas.style.cursor = 'grabbing';
    event.preventDefault();
});
canvas.addEventListener('pointermove', event => {
    const old = pointers.get(event.pointerId);
    if (!old || !demo) {
        return;
    }
    camera.yaw -= (event.clientX - old.x) * 0.004;
    camera.pitch = Math.max(-1.54, Math.min(1.54, camera.pitch + (event.clientY - old.y) * 0.004));
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    event.preventDefault();
    scheduleDraw();
});
function releasePointer(event: PointerEvent): void {
    pointers.delete(event.pointerId);
    if (canvas.hasPointerCapture(event.pointerId)) {
        canvas.releasePointerCapture(event.pointerId);
    }
    canvas.style.cursor = demo ? 'grab' : 'auto';
}
for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) {
    canvas.addEventListener(name, event => {
        if (event instanceof PointerEvent) {
            releasePointer(event);
        }
    });
}
canvas.addEventListener('wheel', event => {
    if (!demo) {
        return;
    }
    event.preventDefault();
    const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? canvas.clientHeight : 1);
    moveCamera(1, 0, 0, -Math.max(-200, Math.min(200, delta)) * Number(speed.value) * 0.002);
    scheduleDraw();
}, { passive: false });
window.addEventListener('blur', clearInput);
document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
        cancelAnimationFrame(frame);
        frame = 0;
        clearInput();
    }
    else {
        scheduleDraw();
    }
});
window.addEventListener('pagehide', () => { release(); status.textContent = '実行ボタンで再初期化します'; });
regenerate.addEventListener('click', () => {
    if (!demo || freeze.checked) {
        return;
    }
    try {
        demo.regenerate(terrainParameters());
        scheduleDraw();
        status.textContent = '地形を再生成しました';
    }
    catch (error) {
        status.textContent = error instanceof Error ? error.message : String(error);
    }
});
amplitudeInput.addEventListener('input', () => { amplitudeValue.value = `${amplitudeInput.value} m`; });
scaleInput.addEventListener('input', () => { scaleValue.value = `${scaleInput.value} m`; });

const lightReadouts: Array<[HTMLInputElement, HTMLOutputElement, string]> = [[azimuth, element('#gpu-light-azimuth-value', HTMLOutputElement), '°'],
    [elevation, element('#gpu-light-elevation-value', HTMLOutputElement), '°'],
    [depthBias, element('#gpu-depth-bias-value', HTMLOutputElement), ''],
    [normalBias, element('#gpu-normal-bias-value', HTMLOutputElement), ' m'],
    [skyIntensity, element('#gpu-sky-intensity-value', HTMLOutputElement), ''],
    [roughness,element('#gpu-roughness-value',HTMLOutputElement),''],
    [metallic,element('#gpu-metallic-value',HTMLOutputElement),''],
    [specularMip,element('#gpu-specular-mip-value',HTMLOutputElement),''],
    ...albedoInputs.map((input): [HTMLInputElement, HTMLOutputElement, string] => [input, element(`#${input.id}-value`, HTMLOutputElement), '']),
    [ev100, element('#gpu-ev100-value', HTMLOutputElement), ' EV'],
    [verticalFov, element('#gpu-fov-value', HTMLOutputElement), '°']];
for (const [input, output, unit] of lightReadouts) {
    input.addEventListener('input', () => { output.value = input.value + unit; scheduleDraw(); });
}
