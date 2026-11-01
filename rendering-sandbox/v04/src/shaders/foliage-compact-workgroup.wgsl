var<workgroup> scan:array<u32,64>;
var<workgroup> base:u32;
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
