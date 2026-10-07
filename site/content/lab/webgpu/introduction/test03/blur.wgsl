@group(0) @binding(0) var sourceTexture: texture_2d<f32>;
@group(0) @binding(1) var sourceSampler: sampler;
struct Options { blur: vec4f, };
@group(0) @binding(2) var<uniform> options: Options;
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
  if (options.blur.x < 0.5) {
    return textureSampleLevel(sourceTexture, sourceSampler, input.uv, 0.0);
  }
  let texel = 1.0 / vec2f(textureDimensions(sourceTexture));
  let weights = array<f32, 3>(1.0, 2.0, 1.0);
  var color = vec4f(0.0);
  for (var y: i32 = -1; y <= 1; y++) {
    for (var x: i32 = -1; x <= 1; x++) {
      let offset = vec2f(f32(x), f32(y)) * texel;
      let weight = weights[u32(x + 1)] * weights[u32(y + 1)];
      color += textureSampleLevel(sourceTexture, sourceSampler, input.uv + offset, 0.0) * weight;
    }
  }
  return color / 16.0;
}
