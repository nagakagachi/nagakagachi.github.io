@group(0) @binding(0) var sourceTexture: texture_2d<f32>;
@group(0) @binding(1) var sourceSampler: sampler;
struct VertexOutput {
    @builtin(position) position: vec4f,
    @location(0) uv: vec2f,
};
@vertex fn vertexMain(@builtin(vertex_index) index: u32) -> VertexOutput {
    let p = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
    var output: VertexOutput;
    output.position = vec4f(p[index], 0.0, 1.0);
    output.uv = vec2f(p[index].x * 0.5 + 0.5, 0.5 - p[index].y * 0.5);
    return output;
}
@fragment fn fragmentMain(input: VertexOutput) -> @location(0) vec4f {
    let color = textureSample(sourceTexture, sourceSampler, input.uv).rgb;
    return vec4f(color + vec3f(0.015, 0.025, 0.035), 1.0);
}
