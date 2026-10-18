@group(0) @binding(0) var outputTexture: texture_storage_2d<rgba8unorm, write>;
@compute @workgroup_size(8, 8, 1)
fn computeMain(@builtin(global_invocation_id) id: vec3u) {
    let size = textureDimensions(outputTexture);
    if (any(id.xy >= size)) { return; }
    let uv = (vec2f(id.xy) + 0.5) / vec2f(size);
    let pi = 3.141592653589793;
    let wave = sin(uv.y * 8.0 * pi + 0.4 * cos(uv.x * 2.0 * pi) * sin(uv.y * pi));
    let band = smoothstep(-0.25, 0.25, wave);
    // Linear reflectance values, not sRGB-encoded colors.
    let color = mix(vec3f(0.42, 0.16, 0.065), vec3f(0.58, 0.27, 0.11), band);
    textureStore(outputTexture, vec2i(id.xy), vec4f(color, 1.0));
}
