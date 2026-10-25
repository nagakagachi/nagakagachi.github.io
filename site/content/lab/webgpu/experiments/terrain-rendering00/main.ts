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
const status = element('#gpu-status', HTMLParagraphElement);
const info = element('#gpu-info', HTMLDListElement);
const snapGrid = element('#gpu-snap', HTMLInputElement);
const showNormals = element('#gpu-normals', HTMLInputElement);
const wireframe = element('#gpu-wireframe', HTMLInputElement);
const tileColors = element('#gpu-tile-colors', HTMLInputElement);
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
const compaction = element('#gpu-compaction', HTMLSelectElement);
const layoutControls = [snapGrid, culling, density, radius, compaction, seedInput, amplitudeInput, scaleInput, regenerate];
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
function viewProjection(): Float32Array<ArrayBuffer> {
    const z: Vec3 = [Math.sin(camera.yaw) * Math.cos(camera.pitch), Math.sin(camera.pitch), Math.cos(camera.yaw) * Math.cos(camera.pitch)];
    const x = normalize(cross([0, 1, 0], z)), y = cross(z, x);
    const eye = camera.position;
    const f = 1 / Math.tan(Math.PI / 6), sx = f / (canvas.width / canvas.height);
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
function detail(label: string, value: string): HTMLElement {
    const dt = document.createElement('dt'), dd = document.createElement('dd');
    dt.textContent = label;
    dd.textContent = value;
    info.append(dt, dd);
    return dd;
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
    if ([...keys].some(code => movementKeys.has(code) || lookKeys.has(code))) {
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
    let cache: HeightClipmap | undefined;
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
        retired.forEach(old => old.dispose());
        buffers.forEach(buffer => buffer.destroy());
        depth?.destroy();
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
        const renderShader = await shader('terrain.wgsl');
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
        const uniform = buffer(480, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST);
        const visible = buffer(MAX_CANDIDATES * 4, GPUBufferUsage.STORAGE);
        const indirect = buffer(20, GPUBufferUsage.STORAGE | GPUBufferUsage.INDIRECT | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC);
        const wireIndirect = buffer(20, GPUBufferUsage.INDIRECT | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC);
        device.queue.writeBuffer(indirect, 0, new Uint32Array([grid.surface.length, 0, 0, 0, 0]));
        device.queue.writeBuffer(wireIndirect, 0, new Uint32Array([grid.wire.length, 0, 0, 0, 0]));
        const readback = buffer(40, GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST);
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
        const computeGroup = device.createBindGroup({ layout: computeLayout, entries: [
                { binding: 0, resource: { buffer: uniform } },
                { binding: 1, resource: { buffer: visible } },
                { binding: 2, resource: { buffer: indirect } }
            ] });
        const groupLayout = device.createBindGroupLayout({ entries: [
                { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
                { binding: 1, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
                { binding: 2, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } }
            ] });
        const pipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [groupLayout] });
        const pipeline = await device.createRenderPipelineAsync({ layout: pipelineLayout,
            vertex: { module: renderShader, entryPoint: 'vertexMain' }, fragment: { module: renderShader, entryPoint: 'fragmentMain', targets: [{ format }] },
            primitive: { topology: 'triangle-list', frontFace: 'ccw', cullMode: 'back' },
            depthStencil: { format: 'depth32float', depthWriteEnabled: true, depthCompare: 'greater' } });
        const wirePipeline = await device.createRenderPipelineAsync({ layout: pipelineLayout,
            vertex: { module: renderShader, entryPoint: 'wireVertexMain' }, fragment: { module: renderShader, entryPoint: 'wireMain', targets: [{ format }] },
            primitive: { topology: 'line-list' }, depthStencil: { format: 'depth32float', depthWriteEnabled: false, depthCompare: 'greater-equal' } });
        check();
        let layout = createLayout(Number(density.value), Number(radius.value));
        let origins = cascadeParameters(camera.position[0], camera.position[2], layout, snapGrid.checked);
        let group: GPUBindGroup;
        function replaceCache(count: number): HeightClipmap {
            const previous = cache;
            const next = new HeightClipmap(device, heightPipeline, count, parameters);
            cache = next;
            group = device.createBindGroup({ layout: groupLayout, entries: [
                    { binding: 0, resource: { buffer: uniform } },
                    { binding: 1, resource: { buffer: next.buffer } },
                    { binding: 2, resource: { buffer: visible } }
                ] });
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
        // 旧来のScene先頭368 Bを維持し、末尾112 Bに7段の標高窓原点を追加する。
        const settings = new Float32Array(120);
        const integers = new Uint32Array(settings.buffer);
        const signed = new Int32Array(settings.buffer);
        let updates = 0;
        let pending = false;
        info.replaceChildren();
        const heightInfo = detail('Height Clipmap', '');
        const heightUpdateInfo = detail('標高生成', '');
        const generationInfo = detail('地形', '');
        detail('共有タイル', `${grid.vertexCount.toLocaleString()}頂点ID / ${(grid.surface.length / 3).toLocaleString()}三角形 / VB 0 B`);
        detail('タイル共有IB', `uint16 / タイル描画 ${indices.size.toLocaleString()} B + ワイヤーフレーム ${wireIndices.size.toLocaleString()} B`);
        detail('GPU描画データ', `可視タイル ${visible.size.toLocaleString()} B / Indirect 40 B / Scene 480 B / 読戻し40 B`);
        const compactInfo = detail('可視リスト集約', '');
        const layoutInfo = detail('メッシュLOD', '');
        const countInfo = detail('カリング', 'GPU結果を取得中');
        const updateInfo = detail('配置・カリング更新', '');
        detail('GPU', adapter.info.description || adapter.info.device || 'ブラウザから機種名は提供されていません');
        function draw(): void {
            if (disposed) {
                return;
            }
            const matrix = viewProjection();
            settings.set(matrix);
            const live = !freeze.checked || updates === 0;
            const encoder = device.createCommandEncoder();
            if (live) {
                layout = createLayout(Number(density.value), Number(radius.value));
                origins = cascadeParameters(camera.position[0], camera.position[2], layout, snapGrid.checked);
                const needed = heightLevels(layout.levels);
                if (!cache || cache.count !== needed) {
                    replaceCache(needed);
                }
                for (let p = 0; p < 6; p++) {
                    for (let j = 0; j < 4; j++) {
                        const w = matrix[j * 4 + 3];
                        settings[16 + p * 4 + j] = p < 4 ? w + (p % 2 === 0 ? 1 : -1) * matrix[j * 4 + Math.floor(p / 2)] : p === 4 ? matrix[j * 4 + 2] : w - matrix[j * 4 + 2];
                    }
                }
            }
            const activeCache = cache;
            if (!activeCache) {
                throw new Error('Height Clipmapが初期化されていません');
            }
            if (live) {
                const stats = activeCache.encode(encoder, camera.position[0], camera.position[2]);
                heightUpdateInfo.textContent = `${stats.levels}段 / ${stats.samples.toLocaleString()}サンプル / ${stats.rectangles}矩形（前回の描画で更新）`;
            }
            const bound = terrainBound(parameters);
            settings.set([-0.4, 0.8, -0.6, 0], 40);
            settings.set([-bound, 1 / (2 * bound), Number(showNormals.checked), Number(tileColors.checked)], 44);
            settings.set([HEIGHT_SIZE, activeCache.count, 1, 0], 48);
            settings.set([0, -bound, bound, 0], 52);
            integers.set([layout.density, layout.levels, layout.count, Number(culling.checked)], 56);
            settings.set(origins, 60);
            signed.set(activeCache.windows, 92);
            device.queue.writeBuffer(uniform, 0, settings);
            if (live) {
                const compute = compaction.value === 'auto' && subgroupCompute ? subgroupCompute : workgroupCompute;
                compactInfo.textContent = compute === subgroupCompute ? 'subgroup集約 / 非空subgroupごとに1 AtomicAdd' : 'workgroup共有メモリscan / 非空workgroupごとに1 AtomicAdd';
                encoder.clearBuffer(indirect, 4, 4);
                const pass = encoder.beginComputePass();
                pass.setPipeline(compute);
                pass.setBindGroup(0, computeGroup);
                pass.dispatchWorkgroups(Math.ceil(layout.count / 64));
                pass.end();
                encoder.copyBufferToBuffer(indirect, 4, wireIndirect, 4, 4);
                updates++;
            }
            const pass = encoder.beginRenderPass({ colorAttachments: [{ view: activeContext.getCurrentTexture().createView(),
                        clearValue: { r: 0.025, g: 0.05, b: 0.06, a: 1 }, loadOp: 'clear', storeOp: 'store' }],
                depthStencilAttachment: { view: depthView, depthClearValue: 0, depthLoadOp: 'clear', depthStoreOp: 'store' } });
            pass.setPipeline(pipeline);
            pass.setBindGroup(0, group);
            pass.setIndexBuffer(indices, 'uint16');
            pass.drawIndexedIndirect(indirect, 0);
            if (wireframe.checked) {
                pass.setPipeline(wirePipeline);
                pass.setIndexBuffer(wireIndices, 'uint16');
                pass.drawIndexedIndirect(wireIndirect, 0);
            }
            pass.end();
            // 状態表示だけを非同期に読む。標高・可視数のCPU取得を待って描画する経路はない。
            const read = !pending;
            const revision = updates;
            const candidates = layout.count;
            if (read) {
                pending = true;
                encoder.copyBufferToBuffer(indirect, 0, readback, 0, 20);
                encoder.copyBufferToBuffer(wireIndirect, 0, readback, 20, 20);
            }
            device.queue.submit([encoder.finish()]);
            if (read) {
                void readback.mapAsync(GPUMapMode.READ).then(() => {
                    const values = new Uint32Array(readback.getMappedRange());
                    const count = values[1];
                    readback.unmap();
                    pending = false;
                    if (!disposed && revision === updates) {
                        countInfo.textContent = `可視 ${count} / 候補 ${candidates} タイル`;
                    }
                    else if (!disposed) {
                        scheduleDraw();
                    }
                }).catch(error => { pending = false; if (!disposed && token === generation) {
                    fail(error);
                } });
            }
            heightInfo.textContent = `1024×1024 × ${activeCache.count}段 / FP16 ${(activeCache.bytes / 1048576).toFixed(0)} MiB / 間隔 ${Array.from({ length: activeCache.count }, (_, l) => 2 ** l).join('・')} m`;
            generationInfo.textContent = `seed ${parameters.seed} / 振幅 ${parameters.amplitude} m / 山スケール ${parameters.scale} m / 高周波は標高段ごとに除去`;
            layoutInfo.textContent = `${layout.levels}段 / セル ${layout.steps.join('・')} m / 半径 ${radius.value} m / 外周半幅 ${layout.radius} m`;
            updateInfo.textContent = `#${updates} / ${freeze.checked ? 'フリーズ中（標高キャッシュも固定）' : 'カメラ追従中'}`;
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
        updateCameraReadout();
    }
    catch (error) {
        if (token === generation) {
            fail(error);
        }
    }
});
resetCamera.addEventListener('click', () => { clearInput(); camera = defaultCamera(); scheduleDraw(); });
for (const control of [wireframe, snapGrid, showNormals, tileColors, culling, density, radius, compaction]) {
    control.addEventListener('change', scheduleDraw);
}
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
