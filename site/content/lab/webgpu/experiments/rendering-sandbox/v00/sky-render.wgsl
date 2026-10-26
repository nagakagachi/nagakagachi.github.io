struct SkyView {
    forward: vec4f,
    right: vec4f, // 水平のtan(FOV/2)を含む。
    up: vec4f, // 垂直のtan(FOV/2)を含む。
}
@group(0) @binding(1) var<uniform> view: SkyView;
struct SkyVertex {
    @builtin(position) clip: vec4f,
    @location(0) ndc: vec2f,
}
@vertex
fn skyVertex(@builtin(vertex_index) id: u32) -> SkyVertex {
    let xy = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
    // Reversed Zの最遠方。既存の地形深度がある画素には描画しない。
    return SkyVertex(vec4f(xy[id], 0.0, 1.0), xy[id]);
}
@fragment
fn skyFragment(input: SkyVertex) -> @location(0) vec4f {
    let ray = normalize(view.forward.xyz + input.ndc.x * view.right.xyz + input.ndc.y * view.up.xyz);
    // 背景はOctahedral Mapを引かず、ピクセルごとに同じ天球関数を直接評価する。
    let linear = skyRadiance(ray);
    return vec4f(pow(linear, vec3f(1.0 / 2.2)), 1.0);
}
