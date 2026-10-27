// PBRT・Unity等で用いられる、+Zを極としてXYへ展開する標準的なOctahedral復号。
// ワールドのY-upとは独立したテクスチャの規約。方向を並べ替えず、ワールドXYZで返す。
// UV中心=+Z、四隅=-Z、右辺中央=+X、左辺中央=-X。
// テクスチャのVは下向きなので、画像上辺中央=-Y、下辺中央=+Yとなる。
// 生成・SH投影はこの原本を共有し、表示側で独自の軸交換やV反転を加えない。
// 参考: https://www.pbr-book.org/4ed/Geometry_and_Transformations/Spherical_Geometry
fn octahedralVector(uv: vec2f) -> vec3f {
    let p = uv * 2.0 - 1.0;
    var v = vec3f(p.x, p.y, 1.0 - abs(p.x) - abs(p.y));
    if (v.z < 0.0) {
        let signs = select(vec2f(-1.0), vec2f(1.0), v.xy >= vec2f(0.0));
        v = vec3f((1.0 - abs(v.y)) * signs.x, (1.0 - abs(v.x)) * signs.y, v.z);
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
