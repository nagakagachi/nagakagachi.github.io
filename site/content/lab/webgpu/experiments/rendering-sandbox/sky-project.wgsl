@group(0) @binding(0) var skyMap: texture_2d<f32>;
@group(0) @binding(1) var<storage, read_write> partials: array<vec4f>;
var<workgroup> sums: array<vec4f, 256>;

@compute @workgroup_size(64)
fn projectSky(@builtin(workgroup_id) group: vec3u, @builtin(local_invocation_index) lane: u32) {
    let size = textureDimensions(skyMap);
    let index = group.x * 64u + lane;
    let pixel = vec2u(index % size.x, index / size.x);
    var radiance = vec3f(0.0);
    var basis = vec4f(0.0);
    var weight = 0.0;
    if (pixel.y < size.y) {
        let uv = (vec2f(pixel) + 0.5) / vec2f(size);
        weight = octahedralWeight(uv);
        basis = shBasis(octahedralDirection(uv));
        radiance = textureLoad(skyMap, vec2i(pixel), 0).rgb;
    }
    for (var c = 0u; c < 4u; c++) {
        // 係数0のWだけに立体角の重み和を持たせる。
        sums[c * 64u + lane] = vec4f(radiance * basis[c] * weight, select(0.0, weight, c == 0u));
    }
    workgroupBarrier();
    for (var stride = 32u; stride > 0u; stride /= 2u) {
        if (lane < stride) {
            for (var c = 0u; c < 4u; c++) {
                sums[c * 64u + lane] += sums[c * 64u + lane + stride];
            }
        }
        workgroupBarrier();
    }
    if (lane == 0u) {
        for (var c = 0u; c < 4u; c++) { partials[group.x * 4u + c] = sums[c * 64u]; }
    }
}
