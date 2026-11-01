@group(1) @binding(8) var screenMask: texture_2d<f32>;
@group(1) @binding(9) var<uniform> screenParams: ScreenParams;

fn screenMaskAt(pixel: vec2f) -> vec2f {
    let size = vec2f(screenParams.dimensions.zw);
    let p = pixel / vec2f(screenParams.dimensions.xy) * size - 0.5;
    let top = vec2i(floor(p));
    let hi = vec2i(screenParams.dimensions.zw) - 1;
    if (screenParams.display.y == 0u) {
        return textureLoad(screenMask, clamp(vec2i(floor(p+0.5)), vec2i(0), hi), 0).ra;
    }
    // 基準実装のBilinear。深度境界を考慮した再構成は後の比較対象とする。
    let f = fract(p);
    let a = textureLoad(screenMask, clamp(top, vec2i(0), hi), 0).ra;
    let b = textureLoad(screenMask, clamp(top+vec2i(1,0), vec2i(0), hi), 0).ra;
    let c = textureLoad(screenMask, clamp(top+vec2i(0,1), vec2i(0), hi), 0).ra;
    let d = textureLoad(screenMask, clamp(top+vec2i(1,1), vec2i(0), hi), 0).ra;
    return mix(mix(a,b,f.x), mix(c,d,f.x), f.y);
}
fn combinedVisibility(csm: f32, pixel: vec2f, world: vec3f) -> f32 {
    if (screenParams.options.x == 0u || screenParams.options.w == 1u) { return csm; }
    let value = screenMaskAt(pixel);
    if (screenParams.options.w == 2u) { return value.x; }
    let z = dot(world-screenParams.camera.xyz, screenParams.forward.xyz);
    let weight = select(smoothstep(screenParams.trace.w*0.9, screenParams.trace.w, z), 1.0,
                        screenParams.display.z != 0u);
    // CSMの範囲内でも短距離成分を適用する。終端の混合から独立させることで、
    // コンタクトシャドウが「CSMに覆われているから無効」になるのを防ぐ。
    let contact = min(csm, value.y);
    if (screenParams.display.z != 0u) { return min(csm, value.x); }
    return mix(contact, value.x, weight);
}
