@group(0) @binding(0) var skyMap: texture_2d<f32>;
@group(0) @binding(1) var<uniform> cameraFrame: CameraFrame;
struct DebugVertex {
    @builtin(position) clip: vec4f,
    @location(0) uv: vec2f,
}
@vertex
fn debugVertex(@builtin(vertex_index) id: u32) -> DebugVertex {
    let p = array<vec2f, 3>(vec2f(-1, -1), vec2f(3, -1), vec2f(-1, 3))[id];
    // 行0を上に表示する。+Z極のMapに対する軸交換や追加のV反転は行わない。
    return DebugVertex(vec4f(p, 0, 1), p * vec2f(0.5, -0.5) + 0.5);
}
@fragment
fn debugFragment(input: DebugVertex) -> @location(0) vec4f {
    let size = textureDimensions(skyMap);
    let pixel = clamp(vec2i(input.uv * vec2f(size)), vec2i(0), vec2i(size) - 1);
    let radiance = textureLoad(skyMap, pixel, 0).rgb;
    // 環境マップ自体は未露出。デバッグ表示のためのコピーにだけPreExposureを掛ける。
    return vec4f(preExposeRadiance(radiance, cameraFrame), 1);
}
