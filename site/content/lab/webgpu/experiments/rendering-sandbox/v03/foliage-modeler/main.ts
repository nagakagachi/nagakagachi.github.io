import {createLeafLods,createLeafLodComparison} from './leaf-lod.js';
import { createTreeAssets, createTreePreviewScene } from './tree-preview.js';
import { DEFAULT_TREE_PARAMETERS, isTreeForm, TREE_PRESETS, SHAPE_CONTROLS } from './tree-model.js';
import type { ShapeKey, TreeShape } from './tree-model.js';
import { PLACEMENT_FLOATS } from './placements.js';
import { DEFAULT_PARAMETERS, DEFAULT_LIBRARY_PARAMETERS, createLeafLibrary, createLeafScene } from './leaf-library.js';
import type { LeafScene } from './leaf-library.js';
import { createPreview } from './preview.js';
import type { OrbitCamera } from './preview.js';

function element<T extends HTMLElement>(id: string, type: { new(): T }): T {
    const value = document.getElementById(id);
    if (!(value instanceof type)) throw new Error(`要素が見つかりません：${id}`);
    return value;
}
const mode=element('model-mode',HTMLSelectElement);
const leafLod=element('leaf-lod',HTMLSelectElement);
const treeCount=element('tree-count',HTMLInputElement),treeVariations=element('tree-variations',HTMLInputElement);
const woodLod=element('wood-lod',HTMLSelectElement),woodRadius=element('wood-radius',HTMLInputElement),woodTaper=element('wood-taper',HTMLInputElement);
const showLeaves=element('show-leaves',HTMLInputElement);
let treeAssets: ReturnType<typeof createTreeAssets> | undefined, treeAssetKey='';
const treeHeight=element('tree-height',HTMLInputElement), crownWidth=element('crown-width',HTMLInputElement);
const socketCount=element('socket-count',HTMLInputElement), bend=element('trunk-bend',HTMLInputElement);
const showTrunk=element('show-trunk',HTMLInputElement);
const treeForm=element('tree-form',HTMLSelectElement), majorCount=element('major-branches',HTMLInputElement);
// 制御項目を定義と共通化し、UIと生成側の範囲が食い違わないようにする。
const shapeFields=element('shape-controls',HTMLDivElement);
const shapeInputs=new Map<ShapeKey, HTMLInputElement>();
for(const key of Object.keys(SHAPE_CONTROLS) as ShapeKey[]) {
    const [title,min,max,step]=SHAPE_CONTROLS[key];
    const label=document.createElement('label'), output=document.createElement('output'), input=document.createElement('input');
    input.type='range'; input.min=String(min); input.max=String(max); input.step=String(step);
    input.value=String(DEFAULT_TREE_PARAMETERS.shape[key]); input.id=`shape-${key}`;
    label.htmlFor=input.id; label.append(title+' ',output,input); shapeFields.append(label);
    shapeInputs.set(key,input);
}
function readShape(): TreeShape {
    const result={...DEFAULT_TREE_PARAMETERS.shape};
    for(const [key,input] of shapeInputs) result[key]=input.valueAsNumber;
    return result;
}
function loadPreset(): void {
    const form=treeForm.value;
    if(!isTreeForm(form)) return;
    const preset=TREE_PRESETS[form];
    majorCount.value=String(preset.majorBranches);
    for(const [key,input] of shapeInputs) input.value=String(preset.shape[key]);
    element('preset-state',HTMLParagraphElement).textContent='プリセットの初期値';
}
const silhouette=element('silhouette',HTMLInputElement);
const canvas = element('gpu-canvas', HTMLCanvasElement);
const start = element('gpu-start', HTMLButtonElement), reset = element('camera-reset', HTMLButtonElement);
const fields = element('parameters', HTMLFieldSetElement), status = element('gpu-status', HTMLParagraphElement);
const info = element('mesh-info', HTMLParagraphElement);
const height = element('height', HTMLInputElement), scale = element('leaf-scale', HTMLInputElement);
const seed = element('seed', HTMLInputElement), spread = element('spread', HTMLInputElement);
const opening = element('opening', HTMLInputElement), debugColors = element('debug-colors', HTMLInputElement);
const classSelect = element('leaf-class', HTMLSelectElement), variationSelect = element('variation',HTMLSelectElement);
const depth = element('depth', HTMLInputElement), leafSize = element('leaf-size', HTMLInputElement);
let library = createLeafLibrary();
let leafLods=createLeafLods(library);
let libraryKey = '', shownView = 'tree:2:1';
const camera: OrbitCamera = { yaw: 0, pitch: 0.6, distance: 18, target: [0, 4, 0] };
let preview: Awaited<ReturnType<typeof createPreview>> | undefined;
let mesh: LeafScene | undefined, frame = 0, regenerateTimer = 0, session = 0;

function requestDraw(): void {
    if (frame || !preview) return;
    frame = requestAnimationFrame(() => {
        frame = 0;
        try { preview?.draw(camera,silhouette.checked); } catch (error) { fail(String(error)); }
    });
}
function frameTree(yaw = 0, pitch = 0.35): void {
    if (!mesh) return;
    const { min, max } = mesh.bounds;
    camera.target = [(min[0]+max[0])/2, (min[1]+max[1])/2, (min[2]+max[2])/2];
    camera.yaw = yaw; camera.pitch = pitch;
    const tangent = Math.tan(Math.PI/8), horizontal = tangent*canvas.clientWidth/canvas.clientHeight;
    let distance = 0;
    // 横並びでも過剰な余白を作らないよう、AABBの8隅を視点軸へ投影して収める。
    for (const x of [min[0],max[0]]) for (const y of [min[1],max[1]]) for (const z of [min[2],max[2]]) {
        const worldX=x-camera.target[0], dy=y-camera.target[1], worldZ=z-camera.target[2];
        const dx=worldX*Math.cos(yaw)-worldZ*Math.sin(yaw), dz=worldX*Math.sin(yaw)+worldZ*Math.cos(yaw);
        const up=dy*Math.cos(camera.pitch)-dz*Math.sin(camera.pitch);
        const depth=dy*Math.sin(camera.pitch)+dz*Math.cos(camera.pitch);
        distance=Math.max(distance,depth+Math.abs(dx)/horizontal,depth+Math.abs(up)/tangent);
    }
    camera.distance = Math.max(0.2,distance*1.12);
    requestDraw();
}
function regenerate(): void {
    if (!preview) return;
    const begin = performance.now();
    try {
        const parameters = { seed: seed.valueAsNumber, spread: spread.valueAsNumber,
            opening: opening.valueAsNumber, depth:depth.valueAsNumber, leafSize:leafSize.valueAsNumber, debugColors: debugColors.checked };
        const key = JSON.stringify(parameters);
        if (key !== libraryKey) {
            const generated = createLeafLibrary(parameters);
            leafLods=createLeafLods(generated);
            preview.updateLibrary(leafLods.flat());
            library = generated; libraryKey = key;
        }
        const classIndex = Number(classSelect.value);
        const treeMode=mode.value==='tree'||mode.value==='forest';
        const form=treeForm.value;
        if(!isTreeForm(form)) throw new Error('樹形が不正です');
        const count=mode.value==='forest'?treeCount.valueAsNumber:1;
        const variations=mode.value==='forest'?treeVariations.valueAsNumber:1;
        const treeParameters={seed:seed.valueAsNumber,height:treeHeight.valueAsNumber,crownWidth:crownWidth.valueAsNumber,
            socketCount:socketCount.valueAsNumber,bend:bend.valueAsNumber,classIndex,variationIndex:Number(variationSelect.value),
            showTrunk:true,form,majorBranches:majorCount.valueAsNumber,shape:readShape()};
        const woodParameters={radiusRatio:woodRadius.valueAsNumber,taper:woodTaper.valueAsNumber};
        const selectedLod=Number(leafLod.value);
        const activeLibrary=leafLods[selectedLod];
        if(treeMode) {
            const assetKey=JSON.stringify([key,treeParameters,woodParameters,variations]);
            if(!treeAssets||assetKey!==treeAssetKey) {
                treeAssets=createTreeAssets(library,treeParameters,woodParameters,variations);
                treeAssetKey=assetKey;
            }
            mesh=createTreePreviewScene(activeLibrary,treeAssets,count,Number(woodLod.value),showTrunk.checked,showLeaves.checked);
        } else if(mode.value==='lod-comparison') {
            mesh=createLeafLodComparison(leafLods,{markerHeight:height.valueAsNumber,leafScale:scale.valueAsNumber,classIndex,variationIndex:Number(variationSelect.value)});
        } else {
            mesh=createLeafScene(activeLibrary,{markerHeight:height.valueAsNumber,leafScale:scale.valueAsNumber,classIndex,variationIndex:Number(variationSelect.value)});
        }
        if(mode.value!=='lod-comparison') {
            const placements=mesh.placements;
            mesh.placements=leafLods.flatMap((_,lod)=>library.map((_,c)=>lod===selectedLod?placements[c]:new Float32Array(0)));
        }
        const drawLibrary=leafLods.flat();
        element('lod-info',HTMLParagraphElement).textContent=mode.value==='lod-comparison'?'左から LOD0 / LOD1 / LOD2 / LOD3（同じ規模クラス・同じバリエーション）':`枝葉 LOD${selectedLod}（規模クラスとは独立）`;
        preview.setScene(mesh);
        element('skeleton-info',HTMLParagraphElement).textContent=treeMode?
            `樹木 ${count}本 · 1本あたり主幹1本・主要枝${majorCount.value}本・取り付け${socketCount.value}個`:'';
        element('sharing-info',HTMLParagraphElement).textContent=mesh.wood?
            `幹：共有IB 1個 · 頂点 ${mesh.wood.geometry.verticesPerVariation}個/形状 × ${variations}形状 · Storage VB ${(mesh.wood.geometry.vertices.byteLength/1024).toFixed(1)} KiB · 配置 ${count}本（${mesh.wood.placements.byteLength} bytes）`:'';
        const memory = preview.resourceBytes;
        const counts = drawLibrary.filter((_,i)=>mesh?.placements[i].length).map(c=>`${c.name}部品1個：枝${c.branchCount*6}tri＋葉${c.leafCount}枚`).join(' / ');
        element('class-info',HTMLParagraphElement).textContent = counts;
        const classes = mesh.placements.filter(p=>p.length>0).length;
        const instances = mesh.placements.reduce((sum,p)=>sum+p.length/PLACEMENT_FLOATS,0);
        const markerDraw=mesh.markerIndices.length>0?1:0;
        const lineDraw=mesh.debugLines?.length?1:0;
        // モデルのTri数はパス数を掛けず、実際に配置したクラスのIBから集計する。
        const leafTriangles=mesh.placements.reduce((sum,placements,i)=>
            sum+placements.length/PLACEMENT_FLOATS*(drawLibrary[i].indices.length/3),0)+mesh.markerIndices.length/3;
        const woodTriangles=mesh.wood?mesh.wood.geometry.indices.length/3*count:0;
        const triangles=leafTriangles+woodTriangles;
        const opaqueDraws=classes+markerDraw+(mesh.wood?1:0);
        const totalDraws=opaqueDraws*2+lineDraw+1;
        element('geometry-info',HTMLParagraphElement).textContent =
            `${treeMode?`樹木${count}本`:'表示モデル'}：合計 ${triangles.toLocaleString('ja-JP')} Tri${treeMode?`（1本平均 ${(triangles/count).toLocaleString('ja-JP',{maximumFractionDigits:1})} Tri · 幹 ${(woodTriangles/count).toLocaleString('ja-JP')} Tri/本）`:''} · 枝葉 ${instances}配置`;
        element('draw-info',HTMLParagraphElement).textContent =
            `合計 ${totalDraws} Draw/フレーム（ZPrePass ${opaqueDraws} · Forward ${opaqueDraws} · 骨格ライン ${lineDraw} · Tonemapping 1）`;
        info.textContent = `GPUバッファ ${(memory/1024).toFixed(1)} KiB · 更新 ${(performance.now()-begin).toFixed(1)} ms`;
        const view = `${mode.value}:${classIndex}:${variationSelect.value}:${treeForm.value}:${majorCount.value}:${count}`;
        if (shownView !== view) { shownView = view; frameTree(); }
        status.textContent = '表示中';
        requestDraw();
    } catch (error) { status.textContent = String(error); }
}
function updateLabels(): void {
    const treeMode=mode.value==='tree'||mode.value==='forest';
    element('tree-controls',HTMLDivElement).hidden=!treeMode;
    element('part-controls',HTMLDivElement).hidden=treeMode;
    element('forest-controls',HTMLDivElement).hidden=mode.value!=='forest';
    leafLod.disabled=mode.value==='lod-comparison';
    for(const [id,input,suffix] of [['tree-height-value',treeHeight,' m'],['crown-width-value',crownWidth,' m'],
        ['socket-count-value',socketCount,''],['trunk-bend-value',bend,' m'],['major-branches-value',majorCount,'本']] as const) {
        element(id,HTMLOutputElement).value=input.value+suffix;
    }
    for(const [id,input] of [['tree-count-value',treeCount],['tree-variations-value',treeVariations],['wood-radius-value',woodRadius],['wood-taper-value',woodTaper]] as const) element(id,HTMLOutputElement).value=input.value;
    for(const input of shapeInputs.values()) {
        const output=input.previousElementSibling;
        if(output instanceof HTMLOutputElement) output.value=input.value;
    }
    element('height-value', HTMLOutputElement).value = `${height.value} m`;
    element('scale-value', HTMLOutputElement).value = scale.value;
    element('spread-value', HTMLOutputElement).value = spread.value;
    element('opening-value', HTMLOutputElement).value = opening.value;
    element('depth-value', HTMLOutputElement).value = depth.value;
    element('leaf-size-value', HTMLOutputElement).value = leafSize.value;
}
function stop(): void {
    session++;
    cancelAnimationFrame(frame); frame = 0;
    clearTimeout(regenerateTimer);
    preview?.dispose(); preview = undefined;
    fields.disabled = true; reset.disabled = true; start.disabled = false;
}
function fail(message: string): void {
    stop(); status.textContent = message; start.textContent = '再実行';
}
start.addEventListener('click', async () => {
    stop();
    const current = session;
    start.disabled = true; status.textContent = 'WebGPUを初期化しています';
    try {
        const created = await createPreview(canvas, leafLods.flat(), message => { if (current === session) fail(message); });
        if (current !== session) { created.dispose(); return; }
        preview = created;
        fields.disabled = false; reset.disabled = false;
        regenerate(); frameTree();
        start.disabled = false; start.textContent = '再実行';
    } catch (error) { if (current === session) fail(String(error)); }
});
treeForm.addEventListener('input',loadPreset);
fields.addEventListener('input', event => {
    if(event.target!==treeForm) element('preset-state',HTMLParagraphElement).textContent='パラメータを調整中';
    updateLabels(); clearTimeout(regenerateTimer);
    // スライダーの途中値でGPUバッファを大量に作り直さない。
    regenerateTimer = window.setTimeout(regenerate, 100);
});
element('defaults', HTMLButtonElement).addEventListener('click', () => {
    clearTimeout(regenerateTimer);
    height.value = String(DEFAULT_PARAMETERS.markerHeight); scale.value = String(DEFAULT_PARAMETERS.leafScale);
    seed.value = String(DEFAULT_LIBRARY_PARAMETERS.seed); spread.value = '1'; opening.value = '1'; depth.value = '1'; leafSize.value = '1';
    debugColors.checked = false; classSelect.value = '2'; variationSelect.value = '1'; mode.value='tree';
    treeHeight.value=String(DEFAULT_TREE_PARAMETERS.height);crownWidth.value=String(DEFAULT_TREE_PARAMETERS.crownWidth);
    socketCount.value=String(DEFAULT_TREE_PARAMETERS.socketCount);bend.value=String(DEFAULT_TREE_PARAMETERS.bend);showTrunk.checked=true;
    leafLod.value='0';treeCount.value='9';treeVariations.value='4';woodLod.value='0';woodRadius.value='0.025';woodTaper.value='1';showLeaves.checked=true;
    treeForm.value=DEFAULT_TREE_PARAMETERS.form;majorCount.value=String(DEFAULT_TREE_PARAMETERS.majorBranches);silhouette.checked=false;
    loadPreset(); updateLabels(); regenerate(); frameTree();
});
reset.addEventListener('click', () => frameTree());
for (const [id,yaw,pitch] of [['view-front',0,0],['view-oblique',0.6,0.5],['view-top',0,Math.PI/2-0.01]] as const) {
    const button=element(id,HTMLButtonElement);
    button.addEventListener('click',()=>{if(preview) frameTree(yaw,pitch);});
}
let pointer: number | undefined, lastX = 0, lastY = 0;
canvas.addEventListener('pointerdown', event => {
    if (!preview || event.button !== 0 || pointer !== undefined) return;
    pointer = event.pointerId; lastX = event.clientX; lastY = event.clientY;
    canvas.setPointerCapture(pointer);
});
canvas.addEventListener('pointermove', event => {
    if (pointer !== event.pointerId) return;
    camera.yaw -= (event.clientX - lastX) * 0.008;
    camera.pitch = Math.max(-1.4, Math.min(1.4, camera.pitch + (event.clientY - lastY) * 0.008));
    lastX = event.clientX; lastY = event.clientY; requestDraw();
});
canvas.addEventListener('pointerup', event => { if (pointer === event.pointerId) { canvas.releasePointerCapture(pointer); pointer = undefined; } });
canvas.addEventListener('lostpointercapture', () => { pointer = undefined; });
canvas.addEventListener('wheel', event => {
    if (!preview) return;
    event.preventDefault();
    const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? canvas.clientHeight : 1);
    camera.distance = Math.max(0.2, Math.min(500, camera.distance * Math.exp(Math.max(-1, Math.min(1, delta * 0.001)))));
    requestDraw();
}, { passive: false });
const resize = new ResizeObserver(requestDraw);
resize.observe(canvas);
window.addEventListener('pagehide', () => { stop(); resize.disconnect(); });
window.addEventListener('pageshow', () => { resize.observe(canvas); });

updateLabels();
