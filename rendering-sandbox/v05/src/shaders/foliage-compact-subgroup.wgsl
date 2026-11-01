// 不可視laneも全ての集約へ参加し、非空subgroupにつき各LODへ1回だけ予約する。
@compute @workgroup_size(64)
fn cull(@builtin(global_invocation_id) gid:vec3u, @builtin(subgroup_invocation_id) lane:u32) {
 let lod=accepted(gid.x);
 for(var level=0u;level<7u;level++) {
  let selected=select(lod.x,lod.y+3,level>=3u);
  let flag=u32(lod.x>=0&&selected==i32(level));
  let rank=subgroupExclusiveAdd(flag);
  let count=subgroupAdd(flag);
  let leader=(lane == 0u);
  var base=0u;
  if(leader&&count>0u){base=atomicAdd(&args[level].instances,count);}
  base=subgroupBroadcastFirst(base);
  if(flag!=0u){items[level*10816u+base+rank]=gid.x;}
 }
}
