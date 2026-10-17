@group(0) @binding(0) var depthTexture: texture_depth_2d;
@vertex fn vertexMain(@builtin(vertex_index) index: u32) -> @builtin(position) vec4f {
    let p = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
    return vec4f(p[index], 0.0, 1.0);
}
@fragment fn fragmentMain(@builtin(position) position: vec4f) -> @location(0) vec4f {
    let depth = textureLoad(depthTexture, vec2i(position.xy), 0);
    return vec4f(vec3f(depth), 1.0);
}
