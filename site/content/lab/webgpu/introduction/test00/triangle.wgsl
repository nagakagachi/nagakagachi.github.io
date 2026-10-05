struct VertexOutput {
  @builtin(position) position: vec4f,
  @location(0) color: vec3f,
};
@vertex fn vertexMain(@builtin(vertex_index) index: u32) -> VertexOutput {
  let positions = array<vec2f, 3>(vec2f(0.0, 0.65), vec2f(-0.6, -0.55), vec2f(0.6, -0.55));
  let colors = array<vec3f, 3>(vec3f(0.66, 0.71, 0.81), vec3f(0.25, 0.55, 0.57), vec3f(0.40, 0.51, 0.69));
  var output: VertexOutput;
  output.position = vec4f(positions[index], 0.0, 1.0);
  output.color = colors[index];
  return output;
}
@fragment fn fragmentMain(input: VertexOutput) -> @location(0) vec4f {
  return vec4f(input.color, 1.0);
}
