@compute @workgroup_size(8, 8)
fn polarScatter(@builtin(global_invocation_id) id: vec3u) {
    let size = textureDimensions(polarMainDepthMap);
    var candidate = vec2u(0xffffffffu);
    if (all(id.xy < size)) {
        candidate = polarScatterSample(id.xy, size);
    }
    //INSERT_SUBGROUP
    if (candidate.x != 0xffffffffu) {
        atomicMax(&polarDepths[candidate.x], candidate.y);
    }
}
