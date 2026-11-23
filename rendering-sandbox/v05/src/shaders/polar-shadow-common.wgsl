struct PolarShadowParameters {
    viewProjection: mat4x4f,
    inverseViewProjection: mat4x4f,
    shadows: array<mat4x4f, 4>,
    camera: vec4f,
    right: vec4f,
    up: vec4f,
    light: vec4f,
    ellipse: vec4f,
    display: vec4f,
    mapping: vec4f, // 正規化内半径、固定押し込みm、キャスターバイアス上限m、セル寸法補正の倍率。
    flags: vec4u,
    history: vec4f, // ディスク中心からカメラへの差分、正規化押し込み量。
}
const PSC_PI: f32 = 3.141592653589793;

// 原点から角度thetaへ伸ばした半直線と、最遠端の投影楕円との遠い交点。
// 楕円が線分になる直交時にも、除算を不安定にせず三角形の外周を復元する。
fn pscRadiusLimit(p: PolarShadowParameters, theta: f32) -> f32 {
    let c = p.ellipse.x;
    let a = p.ellipse.y;
    let b = p.ellipse.z;
    let cs = cos(theta);
    let sn = sin(theta);
    let quadratic = b * b * cs * cs + a * a * sn * sn;
    let linear = c * b * b * cs;
    let constant = b * b * (c * c - a * a);
    let discriminant = max(linear * linear - quadratic * constant, 0.0);
    return max((linear + sqrt(discriminant)) / max(quadratic, 1e-12), 0.0);
}

fn pscLocalUV(p: PolarShadowParameters, local: vec2f) -> vec3f {
    let radius = length(local);
    let theta = select(0.0, atan2(local.y, local.x), radius > 1e-7);
    let limit = pscRadiusLimit(p, theta);
    let inner = p.mapping.x;
    let covered = abs(theta) <= p.ellipse.w + 1e-5 && radius >= inner && radius <= limit + 1e-5;
    let u = select(theta / (2.0 * p.ellipse.w) + 0.5, fract(theta / (2.0 * PSC_PI)), p.right.w < 0.5);
    return vec3f(u, sqrt(clamp((radius - inner) / max(limit - inner, 1e-7), 0.0, 1.0)), f32(covered));
}
