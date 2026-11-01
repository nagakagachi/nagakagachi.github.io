// 深度は照明の色ではないため、露出・トーンマッピング・sRGB符号化を適用しない。
@group(0) @binding(0) var sourceDepth: texture_depth_2d;
struct DepthDebugVertex {
    @builtin(position) position: vec4f,
    @location(0) uv: vec2f,
}
@vertex
fn depthDebugVertex(@builtin(vertex_index) id: u32) -> DepthDebugVertex {
    let p = array<vec2f, 3>(vec2f(-1, -1), vec2f(3, -1), vec2f(-1, 3))[id];
    return DepthDebugVertex(vec4f(p, 0, 1), p * vec2f(0.5, -0.5) + 0.5);
}
@fragment
fn depthDebugFragment(input: DepthDebugVertex) -> @location(0) vec4f {
    let size = textureDimensions(sourceDepth);
    let pixel = clamp(vec2i(input.uv * vec2f(size)), vec2i(0), vec2i(size) - 1);
    let rawDepth = textureLoad(sourceDepth, pixel, 0);
    return vec4f(vec3f(rawDepth), 1.0);
}

// Xはnear距離、YはLinearDepthを白にする正規化距離。CSMのRawDepth表示には使わない。
@group(0) @binding(1) var<uniform> depthRange: vec4f;
@fragment
fn linearDepthFragment(input: DepthDebugVertex) -> @location(0) vec4f {
    let size = textureDimensions(sourceDepth);
    let pixel = clamp(vec2i(input.uv * vec2f(size)), vec2i(0), vec2i(size) - 1);
    let rawDepth = textureLoad(sourceDepth, pixel, 0);
    // 無限遠Reversed Zの視点空間Zを復元する。未描画画素は無限遠として白にする。
    var value = 1.0;
    if (rawDepth > 0.0) {
        let linearDepth = depthRange.x / rawDepth;
        value = clamp(linearDepth / depthRange.y, 0.0, 1.0);
    }
    return vec4f(vec3f(value), 1.0);
}
