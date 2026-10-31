@group(0) @binding(0) var hdr: texture_2d<f32>;
@vertex fn fullscreen(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
    let p = vec2f(f32((i << 1u) & 2u), f32(i & 2u));
    return vec4f(p * 2.0 - 1.0, 0.0, 1.0);
}
@fragment fn display(@builtin(position) position: vec4f) -> @location(0) vec4f {
    let linear = max(textureLoad(hdr, vec2i(position.xy), 0).rgb, vec3f(0.0));
    // ACES Filmicの近似後に、区分関数でsRGBへ変換する。
    let mapped = clamp((linear * (2.51 * linear + 0.03)) / (linear * (2.43 * linear + 0.59) + 0.14), vec3f(0), vec3f(1));
    let srgb = select(1.055 * pow(mapped, vec3f(1.0 / 2.4)) - 0.055, 12.92 * mapped, mapped <= vec3f(0.0031308));
    return vec4f(srgb, 1.0);
}
