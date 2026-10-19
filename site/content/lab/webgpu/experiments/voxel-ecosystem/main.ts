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
const speedValue = element('#gpu-speed-value', HTMLOutputElement);
const canvas = element('#gpu-canvas', HTMLCanvasElement);
const status = element('#gpu-status', HTMLParagraphElement);
const info = element('#gpu-info', HTMLDListElement);
const initialCamera = { yaw: 0.72, pitch: 0.57, extent: 57 };
let camera = { ...initialCamera };
let running = false, busy = false, generation = 0, frame = 0, steps = 0;
let previous: number | undefined, accumulator = 0;
interface Demo { step(): void; draw(): void; reset(): void; dispose(): void }
let demo: Demo | undefined;
function normalize(v: Vec3): Vec3 { const length = Math.hypot(...v); return [v[0]/length,v[1]/length,v[2]/length]; }
function cross(a: Vec3,b: Vec3): Vec3 { return [a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]]; }
function dot(a: Vec3,b: Vec3): number { return a[0]*b[0]+a[1]*b[1]+a[2]*b[2]; }
function viewProjection(): Float32Array<ArrayBuffer> {
  const z: Vec3 = [Math.sin(camera.yaw)*Math.cos(camera.pitch),Math.sin(camera.pitch),Math.cos(camera.yaw)*Math.cos(camera.pitch)];
  const x = normalize(cross([0,1,0],z)), y = cross(z,x);
  const eye: Vec3 = [32+z[0]*160,24+z[1]*160,32+z[2]*160];
  const sx=1/(camera.extent*canvas.width/canvas.height), sy=1/camera.extent;
  // Orthographic Reversed Z: view-space -1 -> 1, -320 -> 0.
  return new Float32Array([x[0]*sx,y[0]*sy,z[0]/319,0, x[1]*sx,y[1]*sy,z[1]/319,0,
    x[2]*sx,y[2]*sy,z[2]/319,0, -dot(x,eye)*sx,-dot(y,eye)*sy,(320-dot(z,eye))/319,1]);
}
function updateStatus(): void {
  status.textContent = `${running ? '実行中' : '停止中'} · ${(steps/60).toFixed(1)}秒 · 生物1個 · 64×64×64`;
}
function pause(): void {
  running=false; cancelAnimationFrame(frame); previous=undefined;
  stop.disabled=true; start.disabled=busy; start.textContent=demo ? '再開' : '実行';
}
function fail(error: unknown): void {
  busy=false; pause(); demo?.dispose(); demo=undefined; generation++;
  for (const control of [reset,cameraReset,speed]) control.disabled=true;
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
    async function shader(name: string): Promise<GPUShaderModule> {
      const response=await fetch(new URL(name,import.meta.url));
      if(!response.ok) throw new Error(`${name}: HTTP ${response.status}`);
      const bytes=new Uint8Array(await response.arrayBuffer());
      if(bytes[0]===239 && bytes[1]===187 && bytes[2]===191) throw new Error(`${name}: UTF-8 BOMは使用できません`);
      let code: string;
      try {code=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes);} catch {throw new Error(`${name}: 不正なUTF-8です`);}
      check(); const module=device.createShaderModule({code});
      const compilation=await module.getCompilationInfo(); check();
      const errors=compilation.messages.filter(m=>m.type==='error');
      if(errors.length) throw new Error(`${name}: ${errors.map(m=>`${m.lineNum}: ${m.message}`).join('; ')}`);
      return module;
    }
    const simulation=await shader('simulation.wgsl'), surface=await shader('surface.wgsl'), render=await shader('render.wgsl');
    device.pushErrorScope('validation');
    function buffer(size: number,usage: GPUBufferUsageFlags): GPUBuffer {const b=device.createBuffer({size,usage});buffers.push(b);return b;}
    const terrain=buffer(64**3*4,GPUBufferUsage.STORAGE);
    const pending=buffer(64**3*4,GPUBufferUsage.STORAGE);
    const creature=buffer(32,GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST);
    const visible=buffer(64**3*4,GPUBufferUsage.STORAGE);
    const indirect=buffer(16,GPUBufferUsage.STORAGE|GPUBufferUsage.INDIRECT|GPUBufferUsage.COPY_DST);
    const uniform=buffer(80,GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST);
    const simulationLayout=device.createBindGroupLayout({entries:[
      {binding:0,visibility:GPUShaderStage.COMPUTE,buffer:{type:'uniform'}},
      ...[1,2,3].map(binding=>({binding,visibility:GPUShaderStage.COMPUTE,buffer:{type:'storage'}} satisfies GPUBindGroupLayoutEntry)),
    ]});
    const simulationPipelineLayout=device.createPipelineLayout({bindGroupLayouts:[simulationLayout]});
    const initializePipeline=await device.createComputePipelineAsync({layout:simulationPipelineLayout,compute:{module:simulation,entryPoint:'initialize'}});
    const movePipeline=await device.createComputePipelineAsync({layout:simulationPipelineLayout,compute:{module:simulation,entryPoint:'advance'}});
    const settlePipeline=await device.createComputePipelineAsync({layout:simulationPipelineLayout,compute:{module:simulation,entryPoint:'settle'}});
    const simulationGroup=device.createBindGroup({layout:simulationLayout,entries:[uniform,terrain,pending,creature].map((b,binding)=>({binding,resource:{buffer:b}}))});
    const compactPipeline=await device.createComputePipelineAsync({layout:'auto',compute:{module:surface,entryPoint:'compact'}});
    const compactGroup=device.createBindGroup({layout:compactPipeline.getBindGroupLayout(0),entries:[terrain,visible,indirect].map((b,binding)=>({binding,resource:{buffer:b}}))});
    const renderLayout=device.createBindGroupLayout({entries:[
      {binding:0,visibility:GPUShaderStage.VERTEX,buffer:{type:'uniform'}},
      ...[1,2,3].map(binding=>({binding,visibility:GPUShaderStage.VERTEX,buffer:{type:'read-only-storage'}} satisfies GPUBindGroupLayoutEntry)),
    ]});
    const renderPipelineLayout=device.createPipelineLayout({bindGroupLayouts:[renderLayout]});
    const renderGroup=device.createBindGroup({layout:renderLayout,entries:[uniform,terrain,visible,creature].map((b,binding)=>({binding,resource:{buffer:b}}))});
    async function pipeline(vertex: string,fragment: string,topology: GPUPrimitiveTopology): Promise<GPURenderPipeline> {
      return device.createRenderPipelineAsync({layout:renderPipelineLayout,vertex:{module:render,entryPoint:vertex},fragment:{module:render,entryPoint:fragment,targets:[{format}]},
        primitive:{topology,cullMode:'none'},depthStencil:{format:'depth32float',depthWriteEnabled:topology==='triangle-list',depthCompare:'greater-equal'}});
    }
    const voxelPipeline=await pipeline('voxel','shade','triangle-list');
    const particlePipeline=await pipeline('particle','shade','triangle-list');
    const boundsPipeline=await pipeline('bounds','line','line-list');
    depth=device.createTexture({size:[canvas.width,canvas.height],format:'depth32float',usage:GPUTextureUsage.RENDER_ATTACHMENT});
    const depthView=depth.createView();
    const validation=await device.popErrorScope(); check(); if(validation) throw new Error(validation.message);
    const settings=new Float32Array(20);
    function writeSettings(): void {settings.set(viewProjection());settings.set([1/60,steps/60,steps%16,0],16);device.queue.writeBuffer(uniform,0,settings);}
    function resetWorld(): void {
      steps=0;accumulator=0;previous=undefined;writeSettings();
      device.queue.writeBuffer(creature,0,new Float32Array([32,10,32,1,0.4,0,0,0]));
      device.queue.writeBuffer(indirect,0,new Uint32Array([36,0,0,0]));
      const encoder=device.createCommandEncoder(), pass=encoder.beginComputePass();
      pass.setPipeline(initializePipeline);pass.setBindGroup(0,simulationGroup);pass.dispatchWorkgroups(16,16,16);pass.end();device.queue.submit([encoder.finish()]);
    }
    function step(): void {
      writeSettings();const encoder=device.createCommandEncoder(),pass=encoder.beginComputePass();
      pass.setBindGroup(0,simulationGroup);pass.setPipeline(movePipeline);pass.dispatchWorkgroups(1);
      pass.setPipeline(settlePipeline);pass.dispatchWorkgroups(16,16,1);pass.end();device.queue.submit([encoder.finish()]);steps++;
    }
    function draw(): void {
      writeSettings();const encoder=device.createCommandEncoder();encoder.clearBuffer(indirect,4,4);
      const compute=encoder.beginComputePass();compute.setPipeline(compactPipeline);compute.setBindGroup(0,compactGroup);compute.dispatchWorkgroups(4096);compute.end();
      const pass=encoder.beginRenderPass({colorAttachments:[{view:activeContext.getCurrentTexture().createView(),clearValue:{r:0.025,g:0.055,b:0.065,a:1},loadOp:'clear',storeOp:'store'}],
        depthStencilAttachment:{view:depthView,depthClearValue:0,depthLoadOp:'clear',depthStoreOp:'store'}});
      pass.setBindGroup(0,renderGroup);pass.setPipeline(voxelPipeline);pass.drawIndirect(indirect,0);
      pass.setPipeline(particlePipeline);pass.draw(16*8*6);pass.setPipeline(boundsPipeline);pass.draw(24);pass.end();device.queue.submit([encoder.finish()]);
    }
    info.replaceChildren();
    for(const [label,value] of [['空間','64×64×64 / ボクセル幅1'],['生物','1個 / GPUで移動と堆積要求を更新'],['地形','16領域を順番に更新 / 1ボクセル256単位'],['GPU',adapter.info.description || adapter.info.device || 'ブラウザから機種名は提供されていません']]) {
      const dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=label;dd.textContent=value;info.append(dt,dd);
    }
    resetWorld();step();draw();return {step,draw,reset:resetWorld,dispose};
  } catch(error) {dispose();throw error;}
}
function tick(timestamp: number): void {
  if(!running || !demo) return;
  try {
    if(previous!==undefined) accumulator+=Math.min((timestamp-previous)/1000,0.1)*Number(speed.value);
    previous=timestamp;let count=0;
    while(accumulator>=1/60 && count<24) {demo.step();accumulator-=1/60;count++;}
    demo.draw();updateStatus();frame=requestAnimationFrame(tick);
  } catch(error) {fail(error);}
}
start.addEventListener('click',async()=>{
  if(busy || running) return;
  busy=true;start.disabled=true;const token=generation;
  try {
    if(!demo) {status.textContent='WebGPUを初期化しています';const initialized=await initialize(token);if(token!==generation){initialized.dispose();return;}demo=initialized;}
    busy=false;running=true;previous=undefined;stop.disabled=false;
    for(const control of [reset,cameraReset,speed]) control.disabled=false;
    canvas.style.touchAction='none';canvas.style.cursor='grab';updateStatus();frame=requestAnimationFrame(tick);
  } catch(error) {if(token===generation) fail(error);}
});
stop.addEventListener('click',()=>{pause();updateStatus();});
reset.addEventListener('click',()=>{if(demo){demo.reset();demo.step();demo.draw();updateStatus();}});
speed.addEventListener('input',()=>{speedValue.value=`${speed.value}×`;});
cameraReset.addEventListener('click',()=>{camera={...initialCamera};demo?.draw();});
const pointers=new Map<number,{x:number;y:number}>();
function clearPointers(): void {for(const id of [...pointers.keys()]){pointers.delete(id);if(canvas.hasPointerCapture(id))canvas.releasePointerCapture(id);}}
function distance(): number {const p=[...pointers.values()];return p.length===2 ? Math.hypot(p[0].x-p[1].x,p[0].y-p[1].y):0;}
function zoom(scale: number): void {camera.extent=Math.max(25,Math.min(100,camera.extent*scale));}
canvas.addEventListener('pointerdown',event=>{if(!demo || event.button!==0 || pointers.size>=2)return;pointers.set(event.pointerId,{x:event.clientX,y:event.clientY});canvas.setPointerCapture(event.pointerId);canvas.style.cursor='grabbing';event.preventDefault();});
canvas.addEventListener('pointermove',event=>{
  const old=pointers.get(event.pointerId);if(!old || !demo)return;const before=distance();pointers.set(event.pointerId,{x:event.clientX,y:event.clientY});
  if(pointers.size===1){camera.yaw-=(event.clientX-old.x)*0.008;camera.pitch=Math.max(0.12,Math.min(1.4,camera.pitch+(event.clientY-old.y)*0.008));}
  else {const after=distance();if(before>0 && after>0)zoom(before/after);}
  event.preventDefault();if(!running)demo.draw();
});
function release(event: PointerEvent): void {pointers.delete(event.pointerId);if(canvas.hasPointerCapture(event.pointerId))canvas.releasePointerCapture(event.pointerId);canvas.style.cursor=demo?'grab':'auto';}
for(const name of ['pointerup','pointercancel','lostpointercapture'])canvas.addEventListener(name,event=>{if(event instanceof PointerEvent)release(event);});
canvas.addEventListener('wheel',event=>{if(!demo)return;event.preventDefault();const delta=event.deltaY*(event.deltaMode===1?16:event.deltaMode===2?canvas.clientHeight:1);zoom(Math.exp(Math.max(-1,Math.min(1,delta*0.001))));if(!running)demo.draw();},{passive:false});
window.addEventListener('blur',clearPointers);
document.addEventListener('visibilitychange',()=>{if(document.hidden && running){pause();clearPointers();updateStatus();}});
window.addEventListener('pagehide',()=>{busy=false;pause();clearPointers();demo?.dispose();demo=undefined;generation++;start.textContent='実行';for(const control of [reset,cameraReset,speed])control.disabled=true;canvas.style.touchAction='auto';});
