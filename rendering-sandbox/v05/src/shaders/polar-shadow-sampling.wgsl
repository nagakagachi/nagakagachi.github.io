@group(2) @binding(0) var<uniform> pscParams: PolarShadowParameters;
@group(2) @binding(1) var pscMap: texture_2d<f32>;
fn pscCompare(cell: vec2i, size: vec2i, reference: f32) -> f32 {
    // 全周時だけ角度を折り返す。扇形の端は別方向へ接続しない。
    let x = select(clamp(cell.x, 0, size.x - 1), (cell.x + size.x) % size.x,
        pscParams.ellipse.w >= PSC_PI);
    let y = clamp(cell.y, 0, size.y - 1);
    let blocker = textureLoad(pscMap, vec2i(x, y), 0).r;
    return select(1.0, 0.0, blocker > reference);
}

fn polarShadowVisibility(position: vec3f) -> f32 {
    if ((pscParams.flags.w & 1u) == 0u) {
        return 1.0;
    }
    let relative = position - pscParams.camera.xyz;
    let local = vec2f(dot(relative, pscParams.right.xyz), dot(relative, pscParams.up.xyz))
        / pscParams.camera.w;
    let uv = pscLocalUV(pscParams, local);
    let depth = dot(relative, pscParams.light.xyz);
    if (uv.z < 0.5 || abs(depth) > pscParams.light.w * 0.5) {
        return 1.0;
    }
    // バイアスはライト軸上のm単位で受光点を光源側へ寄せる。
    let reference = 0.5 + (depth + pscParams.display.w) / pscParams.light.w;
    let size = vec2i(textureDimensions(pscMap));
    if ((pscParams.flags.w & 2u) == 0u) {
        return pscCompare(vec2i(uv.xy * vec2f(size)), size, reference);
    }
    let texel = uv.xy * vec2f(size) - 0.5;
    let base = vec2i(floor(texel));
    let weight = fract(texel);
    let top = mix(pscCompare(base, size, reference),
        pscCompare(base + vec2i(1, 0), size, reference), weight.x);
    let bottom = mix(pscCompare(base + vec2i(0, 1), size, reference),
        pscCompare(base + vec2i(1, 1), size, reference), weight.x);
    return mix(top, bottom, weight.y);
}

// PSCと同じ16テクセル間隔。投影範囲外は暗くし、角度の継ぎ目を補正する。
fn polarSurfaceGrid(position: vec3f) -> vec3f {
    let relative = position - pscParams.camera.xyz;
    let local = vec2f(dot(relative, pscParams.right.xyz), dot(relative, pscParams.up.xyz))
        / pscParams.camera.w;
    let uv = pscLocalUV(pscParams, local);
    let scale = vec2f(textureDimensions(pscMap)) / 16.0;
    var dx = dpdx(uv.xy);
    var dy = dpdy(uv.xy);
    if (pscParams.ellipse.w >= PSC_PI) {
        dx.x -= round(dx.x);
        dy.x -= round(dy.x);
    }
    let footprint = max((abs(dx) + abs(dy)) * scale, vec2f(0.0001));
    let edge = abs(fract(uv.xy * scale + 0.5) - 0.5);
    let lines = (1.0 - smoothstep(vec2f(0.3), vec2f(1.3), edge / footprint))
        * clamp(1.0 - footprint * 2.0, vec2f(0), vec2f(1));
    let covered = uv.z > 0.5 && abs(dot(relative, pscParams.light.xyz)) <= pscParams.light.w * 0.5;
    return select(vec3f(0.15), mix(vec3f(0.65), vec3f(0.015), max(lines.x, lines.y)), covered);
}
