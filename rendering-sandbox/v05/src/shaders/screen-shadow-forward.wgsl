@group(1) @binding(8) var screenMask: texture_2d<f32>;
@group(1) @binding(9) var<uniform> screenParams: ScreenParams;

fn screenMaskAt(pixel: vec2f) -> f32 {
    let size = vec2f(screenParams.dimensions.zw);
    let p = pixel / vec2f(screenParams.dimensions.xy) * size - 0.5;
    let top = vec2i(floor(p));
    let hi = vec2i(screenParams.dimensions.zw) - 1;
    if (screenParams.display.y == 0u) {
        return textureLoad(screenMask, clamp(vec2i(floor(p+0.5)), vec2i(0), hi), 0).r;
    }
    // 基準実装のBilinear。深度境界を考慮した再構成は後の比較対象とする。
    let f = fract(p);
    let a = textureLoad(screenMask, clamp(top, vec2i(0), hi), 0).r;
    let b = textureLoad(screenMask, clamp(top+vec2i(1,0), vec2i(0), hi), 0).r;
    let c = textureLoad(screenMask, clamp(top+vec2i(0,1), vec2i(0), hi), 0).r;
    let d = textureLoad(screenMask, clamp(top+vec2i(1,1), vec2i(0), hi), 0).r;
    return mix(mix(a,b,f.x), mix(c,d,f.x), f.y);
}
fn combinedVisibility(csm: f32, pixel: vec2f) -> f32 {
    if (screenParams.options.x == 0u || screenParams.options.w == 1u) { return csm; }
    let visibility = screenMaskAt(pixel);
    if (screenParams.options.w == 2u) { return visibility; }
    // 距離に関係なくレイ全体の可視率を適用する。距離依存はTraceの配置と厚みだけ。
    // 既にCSMで遮蔽されている部分へ重ねて乗算し、二重に暗くすることはしない。
    return min(csm, visibility);
}
