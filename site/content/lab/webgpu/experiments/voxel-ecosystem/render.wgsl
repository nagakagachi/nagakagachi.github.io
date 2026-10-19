struct Settings { vp: mat4x4f, step: vec4f }
struct Creature { position: vec4f, state: vec4f }
@group(0) @binding(0) var<uniform> settings: Settings;
@group(0) @binding(1) var<storage, read> terrain: array<u32>;
@group(0) @binding(2) var<storage, read> visible: array<u32>;
@group(0) @binding(3) var<storage, read> creature: Creature;
struct Vertex { @builtin(position) clip: vec4f, @location(0) normal: vec3f, @location(1) color: vec3f }
@vertex fn voxel(@builtin(vertex_index) v: u32, @builtin(instance_index) instance: u32) -> Vertex {
  let i = visible[instance];
  let base = vec3f(f32(i%64u), f32(i/4096u), f32((i/64u)%64u));
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
  p = (p-vec3f(0.5,0,0.5))*vec3f(0.98,f32(terrain[i]&511u)/256.0,0.98)+vec3f(0.5,0,0.5);
  let variation = 0.88 + 0.12 * sin(f32(i)*1.73);
  let color = select(vec3f(0.12,0.24,0.26),vec3f(0.68,0.43,0.16), (terrain[i]&512u)!=0u)*variation;
  return Vertex(settings.vp*vec4f(base+p,1),n,color);
}
@vertex fn particle(@builtin(vertex_index) v: u32) -> Vertex {
  let corner = array<vec2u,6>(vec2u(0,0),vec2u(1,0),vec2u(1,1),vec2u(0,0),vec2u(1,1),vec2u(0,1));
  let cell = v/6u; let uv=(vec2f(f32(cell%16u),f32(cell/16u))+vec2f(corner[v%6u]))/vec2f(16,8);
  let a=uv.x*6.2831853; let b=uv.y*3.14159265;
  let n=vec3f(sin(b)*cos(a),cos(b),sin(b)*sin(a));
  return Vertex(settings.vp*vec4f(creature.position.xyz+n*0.65,1),n,vec3f(1.4,0.88,0.28));
}
@fragment fn shade(v: Vertex) -> @location(0) vec4f {
  let diffuse=max(dot(normalize(v.normal),normalize(vec3f(-0.4,0.9,0.5))),0.0);
  let linear=v.color*(0.35+0.65*diffuse);
  return vec4f(pow(clamp(linear,vec3f(0),vec3f(1)),vec3f(1.0/2.2)),1);
}
@vertex fn bounds(@builtin(vertex_index) v: u32) -> @builtin(position) vec4f {
  let edges=array<vec2u,12>(vec2u(0,1),vec2u(1,3),vec2u(3,2),vec2u(2,0),vec2u(4,5),vec2u(5,7),vec2u(7,6),vec2u(6,4),vec2u(0,4),vec2u(1,5),vec2u(2,6),vec2u(3,7));
  let pair=edges[v/2u]; let c=select(pair.x,pair.y,v%2u==1u);
  let p=vec3f(f32(c&1u),f32((c>>1u)&1u),f32((c>>2u)&1u))*64.0;
  return settings.vp*vec4f(p,1);
}
@fragment fn line() -> @location(0) vec4f { return vec4f(0.24,0.36,0.38,1); }
