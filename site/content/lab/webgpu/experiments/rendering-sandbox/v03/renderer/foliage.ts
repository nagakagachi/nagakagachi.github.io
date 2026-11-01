import {createForestAssets} from './forest-assets.js';
import {packPlacements} from '../foliage-modeler/placements.js';
import type {OpaqueRenderable} from './render-passes.js';

export async function createFoliage(device:GPUDevice,shader:(name:string,library?:string,directive?:string,scene?:boolean)=>Promise<GPUShaderModule>,
    lightingLayout:GPUBindGroupLayout,lightingGroup:GPUBindGroup,shadingLibrary:string,views:readonly GPUBuffer[]) {
 const owned:GPUBuffer[]=[];
 const buffer=(size:number,usage:GPUBufferUsageFlags):GPUBuffer=>{const b=device.createBuffer({size,usage:usage|GPUBufferUsage.COPY_DST});owned.push(b);return b;};
 const upload=(data:Float32Array<ArrayBuffer>|Uint16Array<ArrayBuffer>|Uint32Array<ArrayBuffer>,usage:GPUBufferUsageFlags):GPUBuffer=>{
  const b=buffer(Math.ceil(data.byteLength/4)*4,usage);device.queue.writeBuffer(b,0,data);return b;
 };
 try {
 const assets=createForestAssets();
 const library=assets.library;
 const lower=Math.min(...assets.trees.map(s=>s.bounds.min[1]));
 const upper=Math.max(...assets.trees.map(s=>s.bounds.max[1]));
 const boundCenter=(lower+upper)*0.5;
 const boundRadius=Math.max(...assets.trees.map(s=>Math.hypot(
  Math.max(Math.abs(s.bounds.min[0]),Math.abs(s.bounds.max[0]))+0.3,
  Math.max(Math.abs(s.bounds.min[1]-boundCenter),Math.abs(s.bounds.max[1]-boundCenter)),
  Math.max(Math.abs(s.bounds.min[2]),Math.abs(s.bounds.max[2]))+0.3)))+0.3;
 // 規模クラスは中のまま、各バリエーションのLOD0〜3を別の共有トポロジとして保持する。
 const leaves=assets.leafLods.map(library=>{
  const template=library[1];
  return {...template,variationCount:3,vertices:template.vertices.slice(0,3*template.verticesPerVariation*9)};
 });
 const maxLeafRadius=Math.max(...assets.trees.flatMap(tree=>tree.tree.sockets.map(socket=>{
  const leaf=leaves[0];let radius=0;
  for(let i=0;i<leaf.verticesPerVariation;i++){const at=(socket.placement.variationId*leaf.verticesPerVariation+i)*9;radius=Math.max(radius,Math.hypot(leaf.vertices[at],leaf.vertices[at+1],leaf.vertices[at+2]));}
  return radius*socket.placement.scale;
 })));
 const socketCount=assets.trees[0].tree.sockets.length;
 const socketData=packPlacements(assets.trees.flatMap(s=>s.tree.sockets.map(socket=>socket.placement)));
 const sockets=upload(socketData,GPUBufferUsage.STORAGE);
 const roots=buffer(10816*32,GPUBufferUsage.STORAGE);
 const headers=buffer(169*16,GPUBufferUsage.STORAGE);
 const jobs=buffer(144,GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC);
 const readback=buffer(16+140*5,GPUBufferUsage.MAP_READ|GPUBufferUsage.COPY_DST);
 const computeShader=await shader('foliage-compute.wgsl');
 const computeLayout=device.createBindGroupLayout({entries:[
  {binding:0,visibility:GPUShaderStage.COMPUTE,buffer:{type:'uniform'}},
  {binding:1,visibility:GPUShaderStage.COMPUTE,buffer:{type:'uniform'}},
  ...[2,3,4,5,6].map(binding=>({binding,visibility:GPUShaderStage.COMPUTE,buffer:{type:'storage' as const}})),
  {binding:7,visibility:GPUShaderStage.COMPUTE,buffer:{type:'read-only-storage'}}
 ]});
 const computePipelineLayout=device.createPipelineLayout({bindGroupLayouts:[computeLayout]});
 const pipelines=await Promise.all(['schedule','generate','cull','finalize'].map(entryPoint=>device.createComputePipelineAsync({layout:computePipelineLayout,compute:{module:computeShader,entryPoint}})));
 const geometryLayout=device.createBindGroupLayout({entries:[
  {binding:0,visibility:GPUShaderStage.VERTEX|GPUShaderStage.FRAGMENT,buffer:{type:'uniform'}},
  ...[1,2,3,4].map(binding=>({binding,visibility:GPUShaderStage.VERTEX,buffer:{type:'read-only-storage' as const}})),
  {binding:5,visibility:GPUShaderStage.VERTEX|GPUShaderStage.FRAGMENT,buffer:{type:'uniform'}}
 ]});
 const geometryText=await fetch(new URL('foliage-geometry.wgsl',import.meta.url)).then(async response=>{
  if(!response.ok)throw new Error('foliage-geometry.wgslを取得できません');
  const bytes=new Uint8Array(await response.arrayBuffer());
  if(bytes[0]===239&&bytes[1]===187&&bytes[2]===191)throw new Error('foliage-geometry.wgslにBOMがあります');
  try{return new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{throw new Error('foliage-geometry.wgslが不正なUTF-8です');}
 });
 // 深度とForwardで同じ頂点位置関数をコンパイルする。
 const depthModule=await shader('foliage-geometry.wgsl');
 const forwardModule=await shader('foliage-forward.wgsl',geometryText+shadingLibrary);
 const renderPipelines=await Promise.all([false,true].map(async leaf=>{
  const primitive:GPUPrimitiveState={topology:'triangle-list',cullMode:leaf?'none':'back'};
  const depth=await device.createRenderPipelineAsync({layout:device.createPipelineLayout({bindGroupLayouts:[geometryLayout]}),
   vertex:{module:depthModule,entryPoint:'depthMain'},primitive,depthStencil:{format:'depth32float',depthCompare:'greater',depthWriteEnabled:true}});
  const forward=await device.createRenderPipelineAsync({layout:device.createPipelineLayout({bindGroupLayouts:[geometryLayout,lightingLayout]}),
   vertex:{module:forwardModule,entryPoint:'vertexMain'},fragment:{module:forwardModule,entryPoint:'fragmentMain',targets:[{format:'rgba16float'}]},
   primitive,depthStencil:{format:'depth32float',depthCompare:'equal',depthWriteEnabled:false}});
  return {depth,forward};
 }));
 const geometries=[...assets.wood.map((geometry,lod)=>({geometry,lod,part:0})),...leaves.map((geometry,lod)=>({geometry,lod,part:1}))].map(({geometry,lod,part},bucket)=>({
  vertices:upload(geometry.vertices,GPUBufferUsage.STORAGE),indices:upload(geometry.indices,GPUBufferUsage.INDEX),
  info:upload(new Uint32Array([geometry.verticesPerVariation,socketCount,part,bucket,0,0,0,0]),GPUBufferUsage.UNIFORM),
  count:geometry.indices.length,part,lod
 }));
 const state=views.map(uniform=>{
  const visible=buffer(10816*7*4,GPUBufferUsage.STORAGE);
  const args=buffer(140,GPUBufferUsage.STORAGE|GPUBufferUsage.INDIRECT|GPUBufferUsage.COPY_SRC);
  geometries.forEach((g,i)=>device.queue.writeBuffer(args,i*20,new Uint32Array([g.count,0,0,0,0])));
  const config=buffer(64,GPUBufferUsage.UNIFORM);
  const groups=geometries.map(g=>device.createBindGroup({layout:geometryLayout,entries:[
   {binding:0,resource:{buffer:uniform}},{binding:1,resource:{buffer:roots}},{binding:2,resource:{buffer:visible}},
   {binding:3,resource:{buffer:g.vertices}},{binding:4,resource:{buffer:sockets}},{binding:5,resource:{buffer:g.info}}
  ]}));
  return {uniform,visible,args,config,groups};
 });
 let mapping=false,lastEnabled=true;
 let workRevision=0,readRevision=0,lastFocus='';
 let statisticsListener:(message:string)=>void=()=>{};
 let epoch=1,lastKey='',pendingRead=false,alive=true,needsFrame=true,statistics='配置を生成中';
 let heightBuffer:GPUBuffer|undefined,computeGroups:GPUBindGroup[]=[];
 const render=(pass:GPURenderPassEncoder,view:number,forward:boolean):void=>{
  for(let i=0;i<geometries.length;i++) {
   const geometry=geometries[i],pipeline=renderPipelines[geometry.part];
   pass.setPipeline(forward?pipeline.forward:pipeline.depth);pass.setBindGroup(0,state[view].groups[i]);
   if(forward)pass.setBindGroup(1,lightingGroup);
   pass.setIndexBuffer(geometry.indices,'uint16');pass.drawIndexedIndirect(state[view].args,i*20);
  }
 };
 const renderable:OpaqueRenderable={drawDepth(pass,view){render(pass,view==='main'?0:view+1,false);},drawForward(pass){render(pass,0,true);},drawDebug(){}};
 return {renderable,setStatisticsListener(listener:(message:string)=>void):void{statisticsListener=listener;},get needsFrame(){return needsFrame;},get statistics(){return statistics;},
  get bytes(){return owned.reduce((n,b)=>n+b.size,0);},
  encode(encoder:GPUCommandEncoder,height:GPUBuffer,camera:readonly number[],seed:number,density:number,budget:number,enabled:boolean,live:boolean,screenHeight:number,debugMode:number,leafLod:number=-1):void {
   for(const g of geometries)device.queue.writeBuffer(g.info,16,new Uint32Array([debugMode,0,0,0]));
   if(!live)return;
   lastEnabled=enabled;
   const key=`${seed}:${density}`;if(key!==lastKey){epoch++;lastKey=key;}
   const focus=`${epoch}:${Math.floor(camera[0]/64)}:${Math.floor(camera[2]/64)}:${enabled}`;
   if(focus!==lastFocus){lastFocus=focus;workRevision++;needsFrame=enabled;}
   if(height!==heightBuffer){heightBuffer=height;computeGroups=state.map(view=>device.createBindGroup({layout:computeLayout,entries:[
    {binding:0,resource:{buffer:view.uniform}},{binding:1,resource:{buffer:view.config}},{binding:2,resource:{buffer:roots}},
    {binding:3,resource:{buffer:headers}},{binding:4,resource:{buffer:jobs}},{binding:5,resource:{buffer:view.visible}},
    {binding:6,resource:{buffer:view.args}},{binding:7,resource:{buffer:height}}
   ]}));}
   state.forEach((view,i)=>{
    const data=new ArrayBuffer(64),f=new Float32Array(data),u=new Uint32Array(data);
    f.set([camera[0],camera[1],camera[2],i===0?screenHeight:1024]);u.set([seed,epoch,budget,i],4);
    f.set([enabled?density:0,boundCenter,boundRadius,maxLeafRadius/boundRadius],8);u.set([socketCount,leafLod+1,0,0],12);device.queue.writeBuffer(view.config,0,data);
    for(let j=0;j<7;j++)encoder.clearBuffer(view.args,j*20+4,4);
   });
   if(enabled){
    const pass=encoder.beginComputePass({label:'植生チャンク選択・生成'});pass.setBindGroup(0,computeGroups[0]);
    pass.setPipeline(pipelines[0]);pass.dispatchWorkgroups(1);pass.setPipeline(pipelines[1]);pass.dispatchWorkgroups(8);pass.end();
    const cull=encoder.beginComputePass({label:'樹木・CSMカリングとLOD'});
    state.forEach((_,i)=>{cull.setBindGroup(0,computeGroups[i]);cull.setPipeline(pipelines[2]);cull.dispatchWorkgroups(169);
     cull.setPipeline(pipelines[3]);cull.dispatchWorkgroups(4);});cull.end();
   }
   if(!pendingRead){
    pendingRead=true;readRevision=workRevision;encoder.copyBufferToBuffer(jobs,0,readback,0,16);
    state.forEach((view,i)=>encoder.copyBufferToBuffer(view.args,0,readback,16+i*140,140));
    // 読み戻しは表示と次フレームの起床だけに使い、可視数やDraw引数の決定には使わない。

   }
  },afterSubmit():void {
   if(!pendingRead||mapping)return;
   mapping=true;
    void device.queue.onSubmittedWorkDone().then(async()=>{
     if(!alive)return;await readback.mapAsync(GPUMapMode.READ);
     const values=new Uint32Array(readback.getMappedRange());const counts=[values[5],values[10],values[15]];
     const leafCounts=[0,1,2,3].map(lod=>values[4+(3+lod)*5+1]);
     const shadowCounts=[1,2,3,4].map(view=>[0,1,2].reduce((n,lod)=>n+values[4+view*35+lod*5+1],0));
     needsFrame=lastEnabled&&(readRevision!==workRevision||values[1]>0);statistics=`未生成 ${values[1]}/169チャンク · 今回 ${values[0]}チャンク · 幹LOD ${counts.join(' / ')}本 · 枝葉LOD ${leafCounts.join(' / ')}配置 · CSM ${shadowCounts.join(' / ')}本 · 幹3 / 枝葉4 Indirect Draw/パス`;
     readback.unmap();pendingRead=false;mapping=false;
     if(alive)statisticsListener(statistics);
    }).catch(()=>{pendingRead=false;mapping=false;});
  },invalidate():void{epoch++;},dispose():void{alive=false;owned.forEach(b=>b.destroy());}
 };
 }catch(error){owned.forEach(b=>b.destroy());throw error;}
}
