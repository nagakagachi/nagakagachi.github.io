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

// +Z極の標準的な方向→Octahedral UV。
fn octahedralUV(direction: vec3f) -> vec2f {
    let n=direction/dot(abs(direction),vec3f(1.0));
    var p=n.xy;
    if(n.z<0.0) { p=(1.0-abs(p.yx))*select(vec2f(-1.0),vec2f(1.0),p>=vec2f(0.0)); }
    return p*0.5+0.5;
}
// 端を越える4タップを隣の八面体面へ折り返す。clamp/repeat/mirror-repeatとは異なる。
fn octahedralTexel(pixel: vec2i, size: i32) -> vec2i {
    var p=pixel;
    if(p.x<0) { p=vec2i(-p.x-1,size-1-p.y); }
    else if(p.x>=size) { p=vec2i(2*size-1-p.x,size-1-p.y); }
    if(p.y<0) { p=vec2i(size-1-p.x,-p.y-1); }
    else if(p.y>=size) { p=vec2i(size-1-p.x,2*size-1-p.y); }
    return clamp(p,vec2i(0),vec2i(size-1));
}
fn sampleOctLevel(map: texture_2d<f32>, direction: vec3f, mip: i32) -> vec3f {
    let size=i32(textureDimensions(map,mip).x);
    let p=octahedralUV(direction)*f32(size)-0.5;
    let cell=vec2i(floor(p));let f=fract(p);
    let a=textureLoad(map,octahedralTexel(cell,size),mip).rgb;
    let b=textureLoad(map,octahedralTexel(cell+vec2i(1,0),size),mip).rgb;
    let c=textureLoad(map,octahedralTexel(cell+vec2i(0,1),size),mip).rgb;
    let d=textureLoad(map,octahedralTexel(cell+vec2i(1,1),size),mip).rgb;
    return mix(mix(a,b,f.x),mix(c,d,f.x),f.y);
}
// 全Mipでgutter比率を1/16に固定し、UVを共通化する。
// シェーディング時はMip間補間も含めてハードウェアのトリリニア1参照だけで取得する。
fn sampleOctRoughness(map: texture_2d<f32>, filterSampler: sampler, direction: vec3f, roughness: f32) -> vec3f {
    let uv=octahedralUV(direction)*0.875+0.0625;
    return textureSampleLevel(map,filterSampler,uv,clamp(roughness,0.0,1.0)*4.0).rgb;
}
