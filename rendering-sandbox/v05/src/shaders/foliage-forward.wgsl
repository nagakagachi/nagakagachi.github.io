struct VertexOutput {
    @builtin(position) @invariant clip: vec4f,
    @location(0) normal: vec3f,
    @location(1) height: f32,
    @location(2) @interpolate(flat) tileID: u32,
    @location(3) worldPosition: vec3f,
    @location(4) color:vec3f,
}
@vertex fn vertexMain(@builtin(vertex_index) id:u32,@builtin(instance_index) instance:u32)->VertexOutput {
 let p=plantVertex(id,instance);
 return VertexOutput(scene.viewProjection*vec4f(p.world,1),p.normal,p.world.y,0u,p.world,p.color);
}
fn tileColor(id: u32) -> vec3f {
    var h = id * 747796405u + 2891336453u;
    h = ((h >> ((h >> 28u) + 4u)) ^ h) * 277803737u;
    h = (h >> 22u) ^ h;
    return 0.25 + 0.65 * vec3f(f32(h & 255u), f32((h >> 8u) & 255u), f32((h >> 16u) & 255u)) / 255.0;
}

// 不透明PSにdiscard/clip、深度出力、Storage書込は置かない。
@fragment
fn fragmentMain(input: VertexOutput, @builtin(front_facing) front: bool) -> @location(0) vec4f {
    if (meshInfo.debug.x != 0u) { return vec4f(preExposeRadiance(input.color, cameraFrame), 1); }
    let n = normalize(input.normal) * select(-1.0, 1.0, front);
    return shadeOpaqueSurface(input.worldPosition, n, input.color, 0.85, 0.0, input.clip.xy);
}
@fragment
fn wireMain() -> @location(0) vec4f {
    return vec4f(preExposeRadiance(vec3f(0.04, 0.055, 0.065), cameraFrame), 1.0);
}
