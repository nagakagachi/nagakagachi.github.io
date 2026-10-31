const SKY_SH_COEFFICIENTS: u32 = 9u;
struct SkySH {
    coefficients: array<vec4f, 9>, // Lambert畳み込みと1/piを適用済みのRGB係数。Wは予約。
}

// Y-upの実SH正規直交基底。l=0,1,2の順に投影・評価を統一する。
fn shBasis(direction: vec3f) -> array<f32, 9> {
    let x = direction.x;
    let y = direction.y;
    let z = direction.z;
    return array<f32, 9>(
        0.2820947918,
        0.4886025119 * x,
        0.4886025119 * y,
        0.4886025119 * z,
        1.0925484306 * x * y,
        1.0925484306 * y * z,
        0.3153915653 * (3.0 * y * y - 1.0),
        1.0925484306 * x * z,
        0.5462742153 * (x * x - z * z)
    );
}

fn evaluateSkySH(coefficients: SkySH, normal: vec3f) -> vec3f {
    let basis = shBasis(normal);
    var value = vec3f(0.0);
    for (var c = 0u; c < SKY_SH_COEFFICIENTS; c++) {
        value += coefficients.coefficients[c].rgb * basis[c];
    }
    // 有限次数への打切りで負値が出る方向だけ0へ抑える。
    return max(value, vec3f(0.0));
}
