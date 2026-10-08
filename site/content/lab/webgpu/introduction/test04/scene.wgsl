@group(0) @binding(0) var<uniform> options: vec4f;

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
    let t = options.x;
    let p = (input.uv - 0.5) * vec2f(options.w, 1.0);
    let centers = array<vec2f, 3>(
        vec2f(0.55 * cos(t), 0.30 * sin(t * 1.3)),
        vec2f(0.45 * sin(t * 0.7 + 2.0), 0.32 * cos(t * 1.1)),
        vec2f(0.60 * cos(t * 0.9 + 4.0), 0.25 * sin(t * 1.7 + 1.0))
    );
    let colors = array<vec3f, 3>(vec3f(0.25, 0.85, 1.0), vec3f(0.80, 0.60, 1.0), vec3f(1.0, 0.75, 0.30));
    var color = vec3f(0.0);
    for (var i = 0u; i < 3u; i++) {
        let d = distance(p, centers[i]);
        let core = 1.0 - smoothstep(0.025, 0.035, d);
        let halo = 0.12 * exp(-d * d / 0.002);
        color += colors[i] * (core + halo);
    }
    return vec4f(color, 1.0);
}
