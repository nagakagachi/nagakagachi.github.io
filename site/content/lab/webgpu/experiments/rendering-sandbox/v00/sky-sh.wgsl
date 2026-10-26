struct SkySH {
    coefficients: array<vec4f, 4>, // Lambert畳み込みと1/piを適用済みのRGB係数。Wは予約。
}
// 実SHの正規直交基底。0次・1次の順序を[定数, X, Y, Z]に統一する。
fn shBasis(direction: vec3f) -> vec4f {
    return vec4f(0.2820947918, 0.4886025119 * direction);
}
fn evaluateSkySH(coefficients: SkySH, normal: vec3f) -> vec3f {
    let basis = shBasis(normal);
    let value = coefficients.coefficients[0].rgb * basis.x
        + coefficients.coefficients[1].rgb * basis.y
        + coefficients.coefficients[2].rgb * basis.z
        + coefficients.coefficients[3].rgb * basis.w;
    // 低次打切りで負の放射輝度が出る方向だけ0へ抑える。
    return max(value, vec3f(0.0));
}
