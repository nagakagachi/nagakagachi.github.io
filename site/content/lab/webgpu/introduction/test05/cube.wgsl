struct ObjectData {
    mvp: mat4x4f,
    color: vec4f,
};
@group(0) @binding(0) var<uniform> object: ObjectData;
struct VertexOutput {
    @builtin(position) position: vec4f,
    @location(0) color: vec3f,
};
@vertex fn vertexMain(@location(0) position: vec3f, @location(1) shade: f32) -> VertexOutput {
    var output: VertexOutput;
    output.position = object.mvp * vec4f(position, 1.0);
    output.color = object.color.rgb * shade;
    return output;
}
@fragment fn fragmentMain(input: VertexOutput) -> @location(0) vec4f {
    return vec4f(input.color, 1.0);
}
