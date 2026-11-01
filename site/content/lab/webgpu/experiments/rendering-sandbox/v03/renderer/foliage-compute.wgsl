struct Config { camera:vec4f, world:vec4u, settings:vec4f, counts:vec4u }
struct Root { positionScale:vec4f, info:vec4f }
struct Jobs { counts:vec4u, tasks:array<vec4i,8> }
struct Args { indexCount:u32, instances:atomic<u32>, firstIndex:u32, baseVertex:i32, firstInstance:u32 }
@group(0) @binding(1) var<uniform> config:Config;
@group(0) @binding(2) var<storage,read_write> roots:array<Root>;
@group(0) @binding(3) var<storage,read_write> headers:array<vec4i>;
@group(0) @binding(4) var<storage,read_write> jobs:Jobs;
@group(0) @binding(5) var<storage,read_write> items:array<u32>;
@group(0) @binding(6) var<storage,read_write> args:array<Args>;
@group(0) @binding(7) var<storage,read> heights:array<u32>;
fn hash(p:vec2i,salt:u32)->u32 {
 var h=(u32(p.x)*1597334677u)^(u32(p.y)*3812015801u)^config.world.x^salt;
 h=(h^(h>>16u))*2246822519u;h=(h^(h>>13u))*3266489917u;return h^(h>>16u);
}
fn random(p:vec2i,salt:u32)->f32 {return f32(hash(p,salt)>>8u)/16777216.0;}
fn slot(p:vec2i)->u32 {let q=((p%13)+13)%13;return u32(q.y*13+q.x);}
fn heightAt(p:vec2i)->f32 {
 let q=vec2u(p)&vec2u(1023);let h=unpack2x16float(heights[q.y*512u+q.x/2u]);return select(h.x,h.y,(q.x&1u)!=0u);
}
fn ground(p:vec2f)->f32 {
 let a=vec2i(floor(p));let t=fract(p);
 return mix(mix(heightAt(a),heightAt(a+vec2i(1,0)),t.x),mix(heightAt(a+vec2i(0,1)),heightAt(a+vec2i(1)),t.x),t.y);
}
// 小さな固定キャッシュを走査するだけで、可変長キューや大域ソートを持たない。
@compute @workgroup_size(1) fn schedule() {
 let center=vec2i(floor(config.camera.xz/64.0));var pending=0u;
 for(var i=0u;i<169u;i++) {
  let p=center+vec2i(i32(i%13u)-6,i32(i/13u)-6);let h=headers[slot(p)];
  if(any(h.xy!=p)||h.z!=i32(config.world.y)||h.w==0) {pending++;}
 }
 var used=0u;
 for(var k=0u;k<min(config.world.z,8u);k++) {
  var best=0x7fffffffu;var chosen=vec2i(0);var found=false;
  for(var i=0u;i<169u;i++) {
   let offset=vec2i(i32(i%13u)-6,i32(i/13u)-6);let p=center+offset;let h=headers[slot(p)];
   var missing=any(h.xy!=p)||h.z!=i32(config.world.y)||h.w==0;
   for(var j=0u;j<used;j++){if(all(jobs.tasks[j].xy==p)){missing=false;}}
   let distance=u32(dot(vec2f(offset),vec2f(offset))*256.0)+i;
   if(missing&&distance<best){best=distance;chosen=p;found=true;}
  }
  if(found){jobs.tasks[used]=vec4i(chosen,i32(slot(chosen)),0);used++;}
 }
 jobs.counts=vec4u(used,pending,0,0);
}
@compute @workgroup_size(64) fn generate(@builtin(workgroup_id) group:vec3u,@builtin(local_invocation_index) lane:u32) {
 let hasJob=group.x<jobs.counts.x;
 if(hasJob){
 let task=jobs.tasks[group.x];let cell=task.xy*8+vec2i(i32(lane%8u),i32(lane/8u));
 let p=(vec2f(cell)+0.2+vec2f(random(cell,1u),random(cell,2u))*0.6)*8.0;
 // 一候補一スロットなので配置生成にAtomicは不要。更新完了後にだけ世代を公開する。
 var valid=random(cell,3u)<config.settings.x;
 // 隣接チャンクも世界セルで同じ候補を再現し、優先度の低い近接候補だけを落とす。
 let priority=hash(cell,7u);
 for(var z= -1;z<=1;z++){for(var x= -1;x<=1;x++){
  if(x==0&&z==0){continue;}
  let neighbor=cell+vec2i(x,z);
  let q=(vec2f(neighbor)+0.2+vec2f(random(neighbor,1u),random(neighbor,2u))*0.6)*8.0;
  let other=hash(neighbor,7u);
  let wins=other<priority||(other==priority&&(neighbor.y<cell.y||(neighbor.y==cell.y&&neighbor.x<cell.x)));
  if(random(neighbor,3u)<config.settings.x&&wins&&distance(p,q)<6.0){valid=false;}
 }}
 let h=ground(p);let slope=length(vec2f(ground(p+vec2f(1,0))-ground(p-vec2f(1,0)),ground(p+vec2f(0,1))-ground(p-vec2f(0,1))))*0.5;
 roots[u32(task.z)*64u+lane]=Root(vec4f(p.x,h-0.15,p.y,select(0.0,0.85+random(cell,4u)*0.3,valid&&slope<1.1)),vec4f(random(cell,5u)*6.2831853,f32(hash(cell,6u)%3u),0,0));
 }
 storageBarrier();workgroupBarrier();
 if(hasJob&&lane==0u){let task=jobs.tasks[group.x];headers[u32(task.z)]=vec4i(task.xy,i32(config.world.y),1);}
}
var<workgroup> scan:array<u32,64>;
var<workgroup> base:u32;
fn accepted(id:u32)->vec2i {
 let h=headers[id/64u];let center=vec2i(floor(config.camera.xz/64.0));
 if(h.w==0||h.z!=i32(config.world.y)||any(abs(h.xy-center)>vec2i(6))){return vec2i(-1);}
 let root=roots[id];if(root.positionScale.w==0.0){return vec2i(-1);}
 let distance=length(root.positionScale.xz-config.camera.xz);
 let limit=select(384.0,256.0,config.world.w==0u);if(distance>limit){return vec2i(-1);}
 let position=root.positionScale.xyz+vec3f(0,config.settings.y*root.positionScale.w,0);
 let radius=config.settings.z*root.positionScale.w;
 if(scene.layoutInfo.w!=0u){for(var i=0u;i<6u;i++){let p=scene.planes[i];if(dot(p.xyz,position)+p.w< -radius){return vec2i(-1);}}}
 if(scene.shadowCasterVolumeInfo.y!=0u){for(var i=0u;i<scene.shadowCasterVolumeInfo.x;i++){let p=scene.shadowCasterVolumePlanes[i];if(dot(p.xyz,position)+p.w< -radius){return vec2i(-1);}}}
 let clip=scene.viewProjection*vec4f(position,1);
 let scale=length(vec3f(scene.viewProjection[0].y,scene.viewProjection[1].y,scene.viewProjection[2].y));
 let pixels=2.0*radius*scale*config.camera.w*0.5/max(abs(clip.w),0.001);
 let thresholds=select(vec2f(40,12),vec2f(100,35),config.world.w==0u);
 var level=i32(pixels<thresholds.x)+i32(pixels<thresholds.y);
 if(config.world.w==0u){
  // Mainの前回LODを保持し、境界付近の往復で段が頻繁に切り替わるのを抑える。
  let previous=i32(root.info.z);
  if(previous==0&&pixels>85.0){level=0;}
  if(previous==1&&pixels>=30.0&&pixels<=115.0){level=1;}
  if(previous==2&&pixels<40.0){level=2;}
  roots[id].info.z=f32(level);
 }
 let leafPixels=pixels*config.settings.w;
 let leafThreshold=select(vec3f(30,12,4),vec3f(60,25,10),config.world.w==0u);
 var leafLevel=i32(leafPixels<leafThreshold.x)+i32(leafPixels<leafThreshold.y)+i32(leafPixels<leafThreshold.z);
 if(config.world.w==0u){
  let previous=i32(root.info.w);
  if(previous==0&&leafPixels>51.0){leafLevel=0;}
  if(previous==1&&leafPixels>=21.25&&leafPixels<=69.0){leafLevel=1;}
  if(previous==2&&leafPixels>=8.5&&leafPixels<=28.75){leafLevel=2;}
  if(previous==3&&leafPixels<11.5){leafLevel=3;}
 }
 if(config.counts.y!=0u){leafLevel=i32(config.counts.y)-1;}
 if(config.world.w==0u){roots[id].info.w=f32(leafLevel);}
 return vec2i(level,leafLevel);
}
// Workgroup単位のprefix sumで圧縮し、各LODにつき非空Workgroupが1回だけ大域予約する。
@compute @workgroup_size(64) fn cull(@builtin(global_invocation_id) gid:vec3u,@builtin(local_invocation_index) lane:u32) {
 let lod=accepted(gid.x);
 for(var level=0u;level<7u;level++) {
  let selected=select(lod.x,lod.y+3,level>=3u);
  let flag=u32(lod.x>=0&&selected==i32(level));scan[lane]=flag;workgroupBarrier();
  for(var offset=1u;offset<64u;offset*=2u){var value=0u;if(lane>=offset){value=scan[lane-offset];}workgroupBarrier();scan[lane]+=value;workgroupBarrier();}
  if(lane==63u){base=0u;if(scan[63]>0u){base=atomicAdd(&args[level].instances,scan[63]);}}workgroupBarrier();
  if(flag!=0u){items[level*10816u+base+scan[lane]-1u]=gid.x;}workgroupBarrier();
 }
}
// 枝葉の可視木数をソケット数倍し、各LODの枝葉を同クラス同LODでInstanced Drawする。
@compute @workgroup_size(1) fn finalize(@builtin(global_invocation_id) gid:vec3u) {
 let bucket=gid.x+3u;let count=atomicLoad(&args[bucket].instances);
 atomicStore(&args[bucket].instances,count*config.counts.x);
}
