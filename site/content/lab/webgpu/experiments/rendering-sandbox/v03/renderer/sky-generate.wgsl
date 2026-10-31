@group(0) @binding(1) var skyMap: texture_storage_2d<rgba16float, write>;
@compute @workgroup_size(8, 8)
fn generateSky(@builtin(global_invocation_id) id: vec3u) {
    let size = textureDimensions(skyMap);
    if (any(id.xy >= size)) { return; }
    let uv = (vec2f(id.xy) + 0.5) / vec2f(size);
    // +Z極のOctahedral UVから、Y-up世界の方向をそのまま復号する。
    let direction = octahedralDirection(uv);
    textureStore(skyMap, vec2i(id.xy), vec4f(skyRadiance(direction), 1.0));
}
