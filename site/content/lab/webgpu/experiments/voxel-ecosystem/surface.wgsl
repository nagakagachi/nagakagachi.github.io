@group(0) @binding(0) var<storage, read> terrain: array<u32>;
@group(0) @binding(1) var<storage, read_write> visible: array<u32>;
struct Draw { vertices: u32, instances: atomic<u32>, firstVertex: u32, firstInstance: u32 }
@group(0) @binding(2) var<storage, read_write> draw: Draw;
fn full(p: vec3i) -> bool {
  if (any(p < vec3i(0)) || any(p >= vec3i(64))) { return false; }
  return (terrain[u32(p.x + 64 * (p.z + 64 * p.y))] & 511u) == 256u;
}
@compute @workgroup_size(64)
fn compact(@builtin(global_invocation_id) id: vec3u) {
  let i = id.x;
  if (i >= 262144u || (terrain[i] & 511u) == 0u) { return; }
  let p = vec3i(vec3u(i % 64u, i / 4096u, (i / 64u) % 64u));
  if (full(p+vec3i(1,0,0)) && full(p-vec3i(1,0,0)) &&
      full(p+vec3i(0,1,0)) && full(p-vec3i(0,1,0)) &&
      full(p+vec3i(0,0,1)) && full(p-vec3i(0,0,1))) { return; }
  visible[atomicAdd(&draw.instances, 1u)] = i;
}
