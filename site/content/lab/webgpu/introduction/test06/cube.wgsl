@group(0) @binding(0) var<uniform> mvp: mat4x4f;
@group(1) @binding(0) var colorTexture: texture_2d<f32>;
@group(1) @binding(1) var colorSampler: sampler;
struct VertexOutput {
    @builtin(position) position: vec4f,
    @location(0) uv: vec2f,
};
@vertex fn vertexMain(@location(0) position: vec3f, @location(1) uv: vec2f) -> VertexOutput {
    var output: VertexOutput;
    output.position = mvp * vec4f(position, 1.0);
    output.uv = uv;
    return output;
}
@vertex fn previewVertex(@builtin(vertex_index) index: u32) -> VertexOutput {
    let p = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
    var output: VertexOutput;
    output.position = vec4f(p[index], 0.0, 1.0);
    output.uv = vec2f(p[index].x * 0.5 + 0.5, 0.5 - p[index].y * 0.5);
    return output;
}
@fragment fn fragmentMain(input: VertexOutput) -> @location(0) vec4f {
    return textureSample(colorTexture, colorSampler, input.uv);
}
