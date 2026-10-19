@group(0) @binding(1) var<storage,read> terrain: array<u32>;
@group(0) @binding(2) var<storage,read> plants: array<Plant>;
@group(0) @binding(3) var<storage,read> visible: array<u32>;
@group(0) @binding(4) var<storage,read> sunlight: array<u32>;
struct Vertex { @builtin(position) clip: vec4f, @location(0) normal: vec3f, @location(1) color: vec3f }
@vertex fn voxel(@builtin(vertex_index) v: u32, @builtin(instance_index) instance: u32) -> Vertex {
  let i = visible[instance];
  let base=vec3f(coordinate(i));
  let corners = array<vec2f,6>(vec2f(0,0),vec2f(1,0),vec2f(1,1),vec2f(0,0),vec2f(1,1),vec2f(0,1));
  let uv = corners[v%6u];
  var p: vec3f; var n: vec3f;
  switch v/6u {
    case 0u: { p=vec3f(uv.x,uv.y,1); n=vec3f(0,0,1); }
    case 1u: { p=vec3f(1-uv.x,uv.y,0); n=vec3f(0,0,-1); }
    case 2u: { p=vec3f(uv.x,1,1-uv.y); n=vec3f(0,1,0); }
    case 3u: { p=vec3f(uv.x,0,uv.y); n=vec3f(0,-1,0); }
    case 4u: { p=vec3f(1,uv.y,1-uv.x); n=vec3f(1,0,0); }
    default: { p=vec3f(0,uv.y,uv.x); n=vec3f(-1,0,0); }
  }
  p=(p-vec3f(0.5))*0.98+vec3f(0.5);
  let plant=plants[i];
  let variation=0.88+0.12*random(i*29u);
  var color=vec3f(0.12,0.23,0.25)*variation;
  if(terrain[i]==0u) {
    let hue=random(plant.colony*71u);
    color=mix(vec3f(0.12,0.24,0.045),vec3f(0.10,0.52,0.20),plant.energy/maximumEnergy);
    color*=0.8+0.4*hue;
    if(settings.display.x==1u) { color=mix(vec3f(0.6,0.07,0.025),vec3f(0.1,0.75,0.25),plant.energy/maximumEnergy); }
  }
  if(settings.display.x==2u) { color=select(vec3f(0.09,0.12,0.19),vec3f(0.85,0.7,0.2),sunlight[i]!=0u); }
  return Vertex(settings.vp*vec4f(base+p,1),n,color);
}
@fragment fn shade(v: Vertex) -> @location(0) vec4f {
  let diffuse=max(dot(normalize(v.normal),normalize(vec3f(-0.4,0.9,0.5))),0.0);
  let linear=v.color*(0.35+0.65*diffuse);
  return vec4f(pow(clamp(linear,vec3f(0),vec3f(1)),vec3f(1.0/2.2)),1);
}
@vertex fn bounds(@builtin(vertex_index) v: u32) -> @builtin(position) vec4f {
  let edges=array<vec2u,12>(vec2u(0,1),vec2u(1,3),vec2u(3,2),vec2u(2,0),vec2u(4,5),vec2u(5,7),vec2u(7,6),vec2u(6,4),vec2u(0,4),vec2u(1,5),vec2u(2,6),vec2u(3,7));
  let pair=edges[v/2u]; let c=select(pair.x,pair.y,v%2u==1u);
  let p=vec3f(f32(c&1u),f32((c>>1u)&1u),f32((c>>2u)&1u))*vec3f(settings.world.xyz);
  return settings.vp*vec4f(p,1);
}
@fragment fn line() -> @location(0) vec4f { return vec4f(0.24,0.36,0.38,1); }
