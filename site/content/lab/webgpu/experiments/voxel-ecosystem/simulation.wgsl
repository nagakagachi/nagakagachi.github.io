struct Settings { vp: mat4x4f, step: vec4f }
struct Creature { position: vec4f, state: vec4f }
@group(0) @binding(0) var<uniform> settings: Settings;
@group(0) @binding(1) var<storage, read_write> terrain: array<u32>;
@group(0) @binding(2) var<storage, read_write> pending: array<atomic<u32>>;
@group(0) @binding(3) var<storage, read_write> creature: Creature;
fn address(p: vec3u) -> u32 { return p.x + 64u * (p.z + 64u * p.y); }
fn ground(x: u32, z: u32) -> f32 {
  var height = 0.0;
  for (var y = 0u; y < 64u; y++) {
    let fill = terrain[address(vec3u(x, y, z))] & 511u;
    if (fill > 0u) { height = f32(y) + f32(fill) / 256.0; }
  }
  return height;
}
@compute @workgroup_size(4, 4, 4)
fn initialize(@builtin(global_invocation_id) p: vec3u) {
  if (any(p >= vec3u(64))) { return; }
  let x = f32(p.x); let z = f32(p.z);
  let h = 5.0 + 2.0 * sin(x * 0.14) * cos(z * 0.12)
    + 5.0 * exp(-dot(vec2f(x-18.0,z-40.0),vec2f(x-18.0,z-40.0))/160.0);
  let i = address(p);
  terrain[i] = select(0u, 256u, f32(p.y) < floor(h));
  atomicStore(&pending[i], 0u);
}
@compute @workgroup_size(1)
fn advance() {
  let dt = settings.step.x;
  var p = creature.position.xyz;
  var angle = creature.state.x;
  // Deterministic wandering, with steering back into the box near its walls.
  angle += (0.35 * sin(settings.step.y * 0.47) + 0.22) * dt;
  var direction = vec2f(cos(angle), sin(angle));
  let predicted = p.xz + direction * 5.0;
  if (any(predicted < vec2f(3.0)) || any(predicted > vec2f(61.0))) {
    let inward = normalize(vec2f(32.0) - p.xz);
    direction = normalize(mix(direction, inward, min(1.0, dt * 5.0)));
    angle = atan2(direction.y, direction.x);
  }
  p.x = clamp(p.x + direction.x * dt * 4.0, 1.0, 62.0);
  p.z = clamp(p.z + direction.y * dt * 4.0, 1.0, 62.0);
  let cell = vec2u(floor(p.xz));
  let h = ground(cell.x, cell.y);
  p.y = h + 0.85;
  var timer = creature.state.y + dt;
  if (timer >= 0.3) {
    timer -= 0.3;
    let y = u32(floor(h));
    if (y < 63u) {
      // Integer fixed-point units: 256 units form one full voxel.
      atomicAdd(&pending[address(vec3u(cell.x, y, cell.y))], 256u);
    }
  }
  creature.position = vec4f(p, 1.0);
  creature.state = vec4f(angle, timer, 0.0, 0.0);
}
@compute @workgroup_size(4, 4, 4)
fn settle(@builtin(global_invocation_id) local: vec3u) {
  // One four-slice slab per fixed simulation step, cycling through 16 slabs.
  let p = vec3u(local.x, local.y, local.z + u32(settings.step.z) * 4u);
  if (any(p >= vec3u(64))) { return; }
  let i = address(p);
  let fill = terrain[i] & 511u;
  if (fill >= 256u) { return; }
  let requested = atomicLoad(&pending[i]);
  let amount = min(min(requested, 16u), 256u - fill);
  if (amount == 0u) { return; }
  atomicSub(&pending[i], amount);
  terrain[i] = 512u | (fill + amount);
}
