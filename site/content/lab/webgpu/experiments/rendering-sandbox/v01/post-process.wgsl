@group(0) @binding(0) var sceneHdr: texture_2d<f32>;

@vertex
fn postVertex(@builtin(vertex_index) id: u32) -> @builtin(position) vec4f {
    let xy = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
    return vec4f(xy[id], 0.0, 1.0);
}

fn linearToSrgb(linear: vec3f) -> vec3f {
    // Canvasの非sRGB形式へ書くため、表示用のsRGB変換をここで一度だけ行う。
    return select(1.055 * pow(linear, vec3f(1.0 / 2.4)) - 0.055,
        12.92 * linear, linear <= vec3f(0.0031308));
}

// NarkowiczのACES Filmicフィット（CC0）。厳密なACES表示変換ではない。
// 出典: https://knarkowicz.wordpress.com/2016/01/06/aces-filmic-tone-mapping-curve/
fn acesFilmic(linearHdr: vec3f) -> vec3f {
    let numerator = linearHdr * (2.51 * linearHdr + 0.03);
    let denominator = linearHdr * (2.43 * linearHdr + 0.59) + 0.14;
    return clamp(numerator / denominator, vec3f(0.0), vec3f(1.0));
}

@fragment
fn postFragment(@builtin(position) pixel: vec4f) -> @location(0) vec4f {
    let preExposedHdr = max(textureLoad(sceneHdr, vec2i(pixel.xy), 0).rgb, vec3f(0.0));
    // HDRはすでにカメラのPreExposureが適用済み。ここでは再適用しない。
    let mapped = acesFilmic(preExposedHdr);
    return vec4f(linearToSrgb(mapped), 1.0);
}
