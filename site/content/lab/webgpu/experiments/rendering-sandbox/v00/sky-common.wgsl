struct SkyParameters {
    sun: vec4f, // 地表から太陽方向への単位ベクトル、予約。
}
@group(0) @binding(0) var<uniform> sky: SkyParameters;

// ピクセルレイ表示とOctahedral Map生成が共有する線形放射輝度の原本。
// 初期版は晴天風の近似。大気の密度積分や多重散乱はまだ計算しない。
fn skyRadiance(direction: vec3f) -> vec3f {
    let elevation = max(direction.y, 0.0);
    let zenith = vec3f(0.06, 0.22, 0.65);
    let horizon = vec3f(0.65, 0.80, 1.0);
    let upper = mix(horizon, zenith, pow(elevation, 0.45));
    // 太陽周辺の広い散乱光だけを加える。直射光はDirectional Lightが担当し、太陽円盤は含めない。
    let halo = 0.18 * pow(max(dot(direction, sky.sun.xyz), 0.0), 8.0) * smoothstep(0.0, 0.15, direction.y);
    let ground = vec3f(0.025, 0.030, 0.035);
    return mix(ground, upper + halo * vec3f(1.0, 0.85, 0.65), smoothstep(-0.08, 0.02, direction.y));
}
