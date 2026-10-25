// Yを鉛直にしたOctahedral復号。下半球を折り返し、最後に単位球へ正規化する。
fn octahedralVector(uv: vec2f) -> vec3f {
    let p = uv * 2.0 - 1.0;
    var v = vec3f(p.x, 1.0 - abs(p.x) - abs(p.y), p.y);
    if (v.y < 0.0) {
        let signs = select(vec2f(-1.0), vec2f(1.0), v.xz >= vec2f(0.0));
        v = vec3f((1.0 - abs(v.z)) * signs.x, v.y, (1.0 - abs(v.x)) * signs.y);
    }
    return v;
}
fn octahedralDirection(uv: vec2f) -> vec3f {
    return normalize(octahedralVector(uv));
}
fn octahedralWeight(uv: vec2f) -> f32 {
    let v = octahedralVector(uv);
    // 単位球へ放射投影するJacobianは1/|v|^3。最終段で総立体角を4piに正規化する。
    return 1.0 / pow(dot(v, v), 1.5);
}
