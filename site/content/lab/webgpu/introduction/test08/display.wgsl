@group(0) @binding(0) var depthTexture: texture_depth_2d;
struct Output { @builtin(position) position: vec4f, @location(0) uv: vec2f, };
@vertex fn vertexMain(@builtin(vertex_index) index: u32) -> Output {
    let p = array<vec2f,3>(vec2f(-1.0,-1.0),vec2f(3.0,-1.0),vec2f(-1.0,3.0));
    var output: Output;
    output.position = vec4f(p[index],0.0,1.0);
    output.uv = vec2f(p[index].x * 0.5 + 0.5,0.5-p[index].y * 0.5);
    return output;
}
@fragment fn fragmentMain(input: Output) -> @location(0) vec4f {
    let size = textureDimensions(depthTexture);
    let p = clamp(vec2i(input.uv * vec2f(size)),vec2i(0),vec2i(size)-1);
    let depth = textureLoad(depthTexture,p,0);
    return vec4f(vec3f(depth),1.0);
}
