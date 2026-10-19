@group(0) @binding(1) var<storage,read> terrain: array<u32>;
@group(0) @binding(2) var<storage,read> plants: array<Plant>;
@group(0) @binding(3) var<storage,read_write> visible: array<u32>;
struct Draw { vertices: u32, instances: atomic<u32>, firstVertex: u32, firstInstance: u32 }
@group(0) @binding(4) var<storage,read_write> draw: Draw;
fn occupied(p: vec3i) -> bool {
  if(!inside(p)) { return false; }
  let i=address(vec3u(p));return terrain[i]!=0u || plants[i].energy>0.0;
}
@compute @workgroup_size(64)
fn compact(@builtin(global_invocation_id) id: vec3u) {
  let i=id.x;if(i>=settings.world.w) { return; }
  let p=vec3i(coordinate(i));if(!occupied(p)) { return; }
  var exposed=false;
  for(var k=0u;k<6u;k++) { if(!occupied(p+neighbor(k))) { exposed=true;break; } }
  if(exposed) { visible[atomicAdd(&draw.instances,1u)]=i; }
}
