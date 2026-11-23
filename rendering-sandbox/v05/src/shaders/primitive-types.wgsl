struct PrimitiveVertex { position: vec4f, normal: vec4f }
struct PrimitiveInstance {
    position: vec4f, // XYZは根元、Wは地形追従の有効化。
    scale: vec4f, // XYZは拡大率、Wはメタリック。
    rotation: vec4f, // 正規化Quaternion。
    albedo: vec4f, // RGBはリニア反射率、Wはラフネス。
}
fn primitiveRotate(q: vec4f, v: vec3f) -> vec3f {
    return v + 2.0 * cross(q.xyz, cross(q.xyz, v) + q.w * v);
}
