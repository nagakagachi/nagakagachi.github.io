export {};
type Vec3 = [number, number, number];
function element<T extends Element>(id: string, type: { new(): T }): T {
  const value = document.querySelector(id);
  if (!(value instanceof type)) throw new Error(`要素が見つかりません: ${id}`);
  return value;
}
const start = element('#gpu-start', HTMLButtonElement);
const stop = element('#gpu-stop', HTMLButtonElement);
const reset = element('#gpu-reset', HTMLButtonElement);
const cameraReset = element('#gpu-camera-reset', HTMLButtonElement);
const speed = element('#gpu-speed', HTMLInputElement);
const lifetimeControl=element('#gpu-lifetime',HTMLInputElement);
const lifetimeValue=element('#gpu-lifetime-value',HTMLOutputElement);
const seedControl=element('#gpu-seed',HTMLInputElement);
const regenerate=element('#gpu-regenerate',HTMLButtonElement);
const randomSeed=element('#gpu-random-seed',HTMLButtonElement);
let activeSeed=37;
function readSeed(): number {
  const value=seedControl.valueAsNumber;
  if(!Number.isInteger(value) || value<0 || value>0xffffffff) throw new Error('シードは0〜4294967295の整数を入力してください');
  return value;
}
const viewControl=element('#gpu-view',HTMLSelectElement);
const speedValue = element('#gpu-speed-value', HTMLOutputElement);
const canvas = element('#gpu-canvas', HTMLCanvasElement);
const status = element('#gpu-status', HTMLParagraphElement);
const info = element('#gpu-info', HTMLDListElement);
const initialCamera = { yaw: 0.72, pitch: 0.57, distance: 220 };
let camera = { ...initialCamera };
let running = false, busy = false, generation = 0, frame = 0, steps = 0;
const world={x:128,y:64,z:128};
const cellCount=world.x*world.y*world.z;
const stepSeconds=0.25;
let viewDirty=true;
let previous: number | undefined, accumulator = 0;
interface Demo { step(): void; draw(): void; reset(): void; dispose(): void }
let demo: Demo | undefined;
function normalize(v: Vec3): Vec3 { const length = Math.hypot(...v); return [v[0]/length,v[1]/length,v[2]/length]; }
function cross(a: Vec3,b: Vec3): Vec3 { return [a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]]; }
function dot(a: Vec3,b: Vec3): number { return a[0]*b[0]+a[1]*b[1]+a[2]*b[2]; }
function viewProjection(): Float32Array<ArrayBuffer> {
  const z: Vec3 = [Math.sin(camera.yaw)*Math.cos(camera.pitch),Math.sin(camera.pitch),Math.cos(camera.yaw)*Math.cos(camera.pitch)];
  const x = normalize(cross([0,1,0],z)), y = cross(z,x);
  const eye: Vec3 = [world.x/2+z[0]*camera.distance,world.y*0.4+z[1]*camera.distance,world.z/2+z[2]*camera.distance];
  const f=1/Math.tan(Math.PI/6),sx=f/(canvas.width/canvas.height);
  // Perspective Reversed Z, near=0.5 and infinite far: clip.z=near, clip.w=-view.z.
  return new Float32Array([x[0]*sx,y[0]*f,0,-z[0], x[1]*sx,y[1]*f,0,-z[1],
    x[2]*sx,y[2]*f,0,-z[2], -dot(x,eye)*sx,-dot(y,eye)*f,0.5,dot(z,eye)]);

}
function updateStatus(): void {
  status.textContent = `${running ? '実行中' : '停止中'} · ${(steps*stepSeconds).toFixed(1)}秒 · 128×64×128`;
}
function pause(): void {
  running=false; cancelAnimationFrame(frame); previous=undefined;
  stop.disabled=true; start.disabled=busy; start.textContent=demo ? '再開' : '実行';
}
function fail(error: unknown): void {
  busy=false; pause(); demo?.dispose(); demo=undefined; generation++;
  for (const control of [reset,cameraReset,speed,regenerate,viewControl]) control.disabled=true;
  seedControl.disabled=false;randomSeed.disabled=false;
  canvas.style.touchAction='auto'; start.textContent='実行';
  status.textContent=`実行できませんでした: ${error instanceof Error ? error.message : String(error)}`;
}
async function initialize(token: number): Promise<Demo> {
  if (!window.isSecureContext || !navigator.gpu) throw new Error('WebGPU対応ブラウザでHTTPSまたはlocalhostから開いてください');
  const check = (): void => { if (generation!==token) throw new Error('初期化を中断しました'); };
  const adapter=await navigator.gpu.requestAdapter(); check();
  if (!adapter) throw new Error('GPUアダプターを取得できませんでした');
  const device=await adapter.requestDevice();
  const buffers: GPUBuffer[]=[];
  let context: GPUCanvasContext | null=null, depth: GPUTexture | undefined;
  const dispose=(): void => { if (token===generation) context?.unconfigure(); buffers.forEach(b=>b.destroy()); depth?.destroy(); device.destroy(); };
  try {
    check(); context=canvas.getContext('webgpu');
    if (!context) throw new Error('WebGPU Canvasを取得できませんでした');
    const activeContext=context, format=navigator.gpu.getPreferredCanvasFormat();
    context.configure({device,format,alphaMode:'opaque'});
    device.lost.then(({reason,message})=>{ if(token===generation && reason!=='destroyed') fail(new Error(`GPUデバイスを失いました: ${message || reason}`)); });
    device.addEventListener('uncapturederror',event=>{if(token===generation) fail(new Error(event.error.message));});
    async function source(name: string): Promise<string> {
      const response=await fetch(new URL(name,import.meta.url));
      if(!response.ok) throw new Error(`${name}: HTTP ${response.status}`);
      const bytes=new Uint8Array(await response.arrayBuffer());
      if(bytes[0]===239 && bytes[1]===187 && bytes[2]===191) throw new Error(`${name}: UTF-8 BOMは使用できません`);
      let code: string;
      try {code=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes);} catch {throw new Error(`${name}: 不正なUTF-8です`);}
      check(); return code;
    }
    const declarations=await source('world.wgsl');
    async function shader(name: string): Promise<GPUShaderModule> {
      const code=declarations+'\n'+await source(name);
      device.pushErrorScope('validation');
      const module=device.createShaderModule({code});
      const compilation=await module.getCompilationInfo();
      const validation=await device.popErrorScope(); check();
      const errors=compilation.messages.filter(m=>m.type==='error');
      if(errors.length || validation) throw new Error(`${name}: ${errors.map(m=>`${m.lineNum}: ${m.message}`).join('; ') || validation?.message}`);
      return module;
    }
    const simulation=await shader('simulation.wgsl'), surface=await shader('surface.wgsl'), render=await shader('render.wgsl');
    device.pushErrorScope('validation');
    function buffer(size: number,usage: GPUBufferUsageFlags): GPUBuffer {const b=device.createBuffer({size,usage});buffers.push(b);return b;}
    const terrain=buffer(cellCount*4,GPUBufferUsage.STORAGE);
    const plants=[buffer(cellCount*24,GPUBufferUsage.STORAGE),buffer(cellCount*24,GPUBufferUsage.STORAGE)];
    const sunlight=buffer(cellCount*4,GPUBufferUsage.STORAGE);
    const energies=buffer(cellCount*4,GPUBufferUsage.STORAGE);
    const visible=buffer(cellCount*4,GPUBufferUsage.STORAGE);
    const indirect=buffer(16,GPUBufferUsage.STORAGE|GPUBufferUsage.INDIRECT|GPUBufferUsage.COPY_DST);
    const uniform=buffer(112,GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST);
    const simulationLayout=device.createBindGroupLayout({entries:[
      {binding:0,visibility:GPUShaderStage.COMPUTE,buffer:{type:'uniform'}},
      ...[1,2,3,4,5].map(binding=>({binding,visibility:GPUShaderStage.COMPUTE,buffer:{type:binding===2?'read-only-storage':'storage'}} satisfies GPUBindGroupLayoutEntry)),
    ]});
    const simulationPipelineLayout=device.createPipelineLayout({bindGroupLayouts:[simulationLayout]});
    async function compute(entryPoint: string): Promise<GPUComputePipeline> {
      return device.createComputePipelineAsync({layout:simulationPipelineLayout,compute:{module:simulation,entryPoint}});
    }
    const initializePipeline=await compute('initialize'), lightPipeline=await compute('illuminate');
    const seedPipeline=await compute('seedPlants');
    const energyPipeline=await compute('metabolize'), growthPipeline=await compute('grow');
    const simulationGroups=plants.map((old,index)=>device.createBindGroup({layout:simulationLayout,
      entries:[uniform,terrain,old,plants[1-index],sunlight,energies].map((b,binding)=>({binding,resource:{buffer:b}}))}));
    const compactPipeline=await device.createComputePipelineAsync({layout:'auto',compute:{module:surface,entryPoint:'compact'}});
    const compactGroups=plants.map(plant=>device.createBindGroup({layout:compactPipeline.getBindGroupLayout(0),entries:[uniform,terrain,plant,visible,indirect].map((b,binding)=>({binding,resource:{buffer:b}}))}));
    const renderLayout=device.createBindGroupLayout({entries:[
      {binding:0,visibility:GPUShaderStage.VERTEX,buffer:{type:'uniform'}},
      ...[1,2,3,4].map(binding=>({binding,visibility:GPUShaderStage.VERTEX,buffer:{type:'read-only-storage'}} satisfies GPUBindGroupLayoutEntry)),
    ]});
    const renderPipelineLayout=device.createPipelineLayout({bindGroupLayouts:[renderLayout]});
    const renderGroups=plants.map(plant=>device.createBindGroup({layout:renderLayout,entries:[uniform,terrain,plant,visible,sunlight].map((b,binding)=>({binding,resource:{buffer:b}}))}));
    async function pipeline(vertex: string,fragment: string,topology: GPUPrimitiveTopology): Promise<GPURenderPipeline> {
      return device.createRenderPipelineAsync({layout:renderPipelineLayout,vertex:{module:render,entryPoint:vertex},fragment:{module:render,entryPoint:fragment,targets:[{format}]},
        primitive:{topology,cullMode:'back'},depthStencil:{format:'depth32float',depthWriteEnabled:topology==='triangle-list',depthCompare:'greater-equal'}});
    }
    const voxelPipeline=await pipeline('voxel','shade','triangle-list');
    const boundsPipeline=await pipeline('bounds','line','line-list');
    depth=device.createTexture({size:[canvas.width,canvas.height],format:'depth32float',usage:GPUTextureUsage.RENDER_ATTACHMENT});
    const depthView=depth.createView();
    const validation=await device.popErrorScope(); check(); if(validation) throw new Error(validation.message);
    const settings=new ArrayBuffer(112), floats=new Float32Array(settings), integers=new Uint32Array(settings);
    let current=1, surfaceDirty=true;
    const workgroups=Math.ceil(cellCount/64),columns=Math.ceil(world.x*world.z/64);
    function writeSettings(): void {
      floats.set(viewProjection()); integers.set([world.x,world.y,world.z,cellCount],16);
      floats.set([stepSeconds,steps,steps*stepSeconds,Number(lifetimeControl.value)],20);
      integers.set([Number(viewControl.value),activeSeed,0,0],24);
      device.queue.writeBuffer(uniform,0,settings);
    }
    function resetWorld(): void {
      element('#gpu-seed-info',HTMLElement).textContent=String(activeSeed);
      steps=0;accumulator=0;previous=undefined;current=1;surfaceDirty=true;viewDirty=true;writeSettings();
      device.queue.writeBuffer(indirect,0,new Uint32Array([36,0,0,0]));
      const encoder=device.createCommandEncoder(), pass=encoder.beginComputePass();
      pass.setPipeline(initializePipeline);pass.setBindGroup(0,simulationGroups[0]);pass.dispatchWorkgroups(workgroups);
      pass.setPipeline(seedPipeline);pass.dispatchWorkgroups(workgroups);
      pass.setPipeline(lightPipeline);pass.setBindGroup(0,simulationGroups[current]);pass.dispatchWorkgroups(columns);
      pass.end();device.queue.submit([encoder.finish()]);
    }
    function step(): void {
      writeSettings();const encoder=device.createCommandEncoder(),pass=encoder.beginComputePass();
      pass.setBindGroup(0,simulationGroups[current]);
      pass.setPipeline(lightPipeline);pass.dispatchWorkgroups(columns);
      pass.setPipeline(energyPipeline);pass.dispatchWorkgroups(workgroups);
      pass.setPipeline(growthPipeline);pass.dispatchWorkgroups(workgroups);
      current=1-current;
      pass.setBindGroup(0,simulationGroups[current]);pass.setPipeline(lightPipeline);pass.dispatchWorkgroups(columns);
      pass.end();device.queue.submit([encoder.finish()]);steps++;surfaceDirty=true;
    }
    function draw(): void {
      writeSettings();const encoder=device.createCommandEncoder();
      if(surfaceDirty) {
        encoder.clearBuffer(indirect,4,4);
        const compute=encoder.beginComputePass();compute.setPipeline(compactPipeline);compute.setBindGroup(0,compactGroups[current]);compute.dispatchWorkgroups(workgroups);compute.end();surfaceDirty=false;
      }
      const pass=encoder.beginRenderPass({colorAttachments:[{view:activeContext.getCurrentTexture().createView(),clearValue:{r:0.025,g:0.055,b:0.065,a:1},loadOp:'clear',storeOp:'store'}],
        depthStencilAttachment:{view:depthView,depthClearValue:0,depthLoadOp:'clear',depthStoreOp:'store'}});
      pass.setBindGroup(0,renderGroups[current]);pass.setPipeline(voxelPipeline);pass.drawIndirect(indirect,0);
      pass.setPipeline(boundsPipeline);pass.draw(24);pass.end();device.queue.submit([encoder.finish()]);viewDirty=false;
    }
    info.replaceChildren();
    for(const [label,value] of [['空間','128×64×128 / 1,048,576セル'],['シード',String(activeSeed)],['更新','固定0.25秒 / 日照・エネルギー・成長をGPUで更新'],['状態','植物24バイト×2面 / 毎フレームのCPU読出しなし'],['GPU',adapter.info.description || adapter.info.device || 'ブラウザから機種名は提供されていません']]) {
      const dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=label;dd.textContent=value;if(label==='シード')dd.id='gpu-seed-info';info.append(dt,dd);
    }
    resetWorld();draw();return {step,draw,reset:resetWorld,dispose};
  } catch(error) {dispose();throw error;}
}
function tick(timestamp: number): void {
  if(!running || !demo) return;
  try {
    if(previous!==undefined) accumulator=Math.min(accumulator+Math.min((timestamp-previous)/1000,0.5)*Number(speed.value),stepSeconds*4);
    previous=timestamp;let count=0;
    while(accumulator>=stepSeconds && count<4) {demo.step();accumulator-=stepSeconds;count++;}
    if(count>0 || viewDirty)demo.draw();updateStatus();frame=requestAnimationFrame(tick);
  } catch(error) {fail(error);}
}
start.addEventListener('click',async()=>{
  if(busy || running) return;
  try {if(!demo)activeSeed=readSeed();} catch(error) {status.textContent=error instanceof Error ? error.message : String(error);return;}
  busy=true;start.disabled=true;seedControl.disabled=true;randomSeed.disabled=true;const token=generation;
  try {
    if(!demo) {status.textContent='WebGPUを初期化しています';const initialized=await initialize(token);if(token!==generation){initialized.dispose();return;}demo=initialized;}
    busy=false;seedControl.disabled=false;randomSeed.disabled=false;running=true;previous=undefined;stop.disabled=false;
    for(const control of [reset,cameraReset,speed,regenerate,viewControl]) control.disabled=false;
    canvas.style.touchAction='none';canvas.style.cursor='grab';updateStatus();frame=requestAnimationFrame(tick);
  } catch(error) {if(token===generation) fail(error);}
});
stop.addEventListener('click',()=>{pause();updateStatus();});
reset.addEventListener('click',()=>{if(demo){demo.reset();demo.draw();updateStatus();}});
function regenerateWorld(): void {
  try {
    const seed=readSeed();
    if(demo){activeSeed=seed;demo.reset();demo.draw();updateStatus();}
  } catch(error) {status.textContent=error instanceof Error ? error.message : String(error);}
}
regenerate.addEventListener('click',regenerateWorld);
seedControl.addEventListener('keydown',event=>{if(event.key==='Enter' && !busy)regenerateWorld();});
randomSeed.addEventListener('click',()=>{
  seedControl.value=String(crypto.getRandomValues(new Uint32Array(1))[0]);
  if(demo)regenerateWorld();
});
viewControl.addEventListener('change',()=>{demo?.draw();});
lifetimeControl.addEventListener('input',()=>{lifetimeValue.value=Number(lifetimeControl.value)===0?'無効':`${lifetimeControl.value}秒`;});
speed.addEventListener('input',()=>{speedValue.value=`${speed.value}×`;});
cameraReset.addEventListener('click',()=>{camera={...initialCamera};demo?.draw();});
const pointers=new Map<number,{x:number;y:number}>();
function clearPointers(): void {for(const id of [...pointers.keys()]){pointers.delete(id);if(canvas.hasPointerCapture(id))canvas.releasePointerCapture(id);}}
function distance(): number {const p=[...pointers.values()];return p.length===2 ? Math.hypot(p[0].x-p[1].x,p[0].y-p[1].y):0;}
function zoom(scale: number): void {camera.distance=Math.max(70,Math.min(420,camera.distance*scale));}
canvas.addEventListener('pointerdown',event=>{if(!demo || event.button!==0 || pointers.size>=2)return;pointers.set(event.pointerId,{x:event.clientX,y:event.clientY});canvas.setPointerCapture(event.pointerId);canvas.style.cursor='grabbing';event.preventDefault();});
canvas.addEventListener('pointermove',event=>{
  const old=pointers.get(event.pointerId);if(!old || !demo)return;const before=distance();pointers.set(event.pointerId,{x:event.clientX,y:event.clientY});
  if(pointers.size===1){camera.yaw-=(event.clientX-old.x)*0.008;camera.pitch=Math.max(0.12,Math.min(1.4,camera.pitch+(event.clientY-old.y)*0.008));}
  else {const after=distance();if(before>0 && after>0)zoom(before/after);}
  event.preventDefault();viewDirty=true;if(!running)demo.draw();
});
function release(event: PointerEvent): void {pointers.delete(event.pointerId);if(canvas.hasPointerCapture(event.pointerId))canvas.releasePointerCapture(event.pointerId);canvas.style.cursor=demo?'grab':'auto';}
for(const name of ['pointerup','pointercancel','lostpointercapture'])canvas.addEventListener(name,event=>{if(event instanceof PointerEvent)release(event);});
canvas.addEventListener('wheel',event=>{if(!demo)return;event.preventDefault();const delta=event.deltaY*(event.deltaMode===1?16:event.deltaMode===2?canvas.clientHeight:1);zoom(Math.exp(Math.max(-1,Math.min(1,delta*0.001))));viewDirty=true;if(!running)demo.draw();},{passive:false});
window.addEventListener('blur',clearPointers);
document.addEventListener('visibilitychange',()=>{if(document.hidden && running){pause();clearPointers();updateStatus();}});
window.addEventListener('pagehide',()=>{busy=false;pause();clearPointers();demo?.dispose();demo=undefined;generation++;start.textContent='実行';seedControl.disabled=false;randomSeed.disabled=false;for(const control of [reset,cameraReset,speed,regenerate,viewControl])control.disabled=true;canvas.style.touchAction='auto';});
