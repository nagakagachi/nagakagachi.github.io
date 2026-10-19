// Shared declarations local to this experiment. Dimensions come only from TypeScript settings.
struct Settings { vp: mat4x4f, world: vec4u, clock: vec4f, display: vec4u, ecology: vec4f }
struct Plant { energy: f32, age: f32, parent: u32, birth: u32, parentBirth: u32, colony: u32, upProbability: f32, generation: u32 }
const maximumEnergy=12.0;
const birthCost=4.0;
const childEnergy=2.0;
const transportRate=0.4;
@group(0) @binding(0) var<uniform> settings: Settings;
fn inside(p: vec3i) -> bool { return all(p>=vec3i(0)) && all(p<vec3i(settings.world.xyz)); }
fn address(p: vec3u) -> u32 { return p.x+settings.world.x*(p.z+settings.world.z*p.y); }
fn coordinate(i: u32) -> vec3u { return vec3u(i%settings.world.x,i/(settings.world.x*settings.world.z),(i/settings.world.x)%settings.world.z); }
fn random(seed: u32) -> f32 {
  var h=seed; h=(h^(h>>16u))*0x7feb352du; h=(h^(h>>15u))*0x846ca68bu; h=h^(h>>16u);
  return f32(h>>8u)/16777216.0;
}
fn emptyPlant() -> Plant { return Plant(0,0,0u,0u,0u,0u,0.5,0u); }
fn neighbor(k: u32) -> vec3i {
  let offsets=array<vec3i,6>(vec3i(0,1,0),vec3i(1,0,0),vec3i(-1,0,0),vec3i(0,0,1),vec3i(0,0,-1),vec3i(0,-1,0));
  return offsets[k];
}
