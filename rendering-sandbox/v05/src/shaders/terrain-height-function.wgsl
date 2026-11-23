fn hashCell(cell: vec2i, seed: u32) -> f32 {
    var h = (u32(cell.x) * 1597334677u) ^ (u32(cell.y) * 3812015801u) ^ (seed * 2798796415u);
    h = (h ^ (h >> 16u)) * 2246822519u;
    h = (h ^ (h >> 13u)) * 3266489917u;
    h ^= h >> 16u;
    return f32(h >> 8u) / 16777215.0;
}

fn valueNoise(p: vec2f, seed: u32) -> f32 {
    let cell = vec2i(floor(p));
    let t = fract(p);
    let f = t * t * t * (t * (t * 6.0 - 15.0) + 10.0);
    return mix(mix(hashCell(cell, seed), hashCell(cell + vec2i(1, 0), seed), f.x),
        mix(hashCell(cell + vec2i(0, 1), seed), hashCell(cell + vec2i(1, 1), seed), f.x), f.y);
}

fn proceduralTerrainHeight(worldXZ: vec2f, seed: u32, amplitudeScale: f32, mountainScale: f32, spacing: f32) -> f32 {
    let scale = mountainScale;
    // 低周波の座標変形で、規則的なノイズの山並みを曲げる。
    let warp = vec2f(valueNoise(worldXZ / (scale * 1.7) + vec2f(7.3, 2.1), seed + 11u),
        valueNoise(worldXZ / (scale * 1.7) + vec2f(-3.1, 9.7), seed + 23u));
    let p = worldXZ + (warp - 0.5) * scale * 0.25;
    let broadHeight = valueNoise(p / (scale * 2.0), seed + 37u) - 0.5;
    var frequency = 1.0 / scale;
    var amplitude = 0.5;
    var detail = 0.0;
    for (var octave = 0u; octave < 9u; octave++) {
        // 波長8〜16サンプルの帯域を滑らかに落とし、それ以上の高周波は生成しない。
        // 判定値は同じdispatch内で共通なので、各地点のノイズ値では反復回数を変えない。
        let weight = 1.0 - smoothstep(0.0625, 0.125, spacing * frequency);
        if (weight <= 0.0) { break; }
        let n = valueNoise(p * frequency, seed + 101u + octave * 17u);
        let ridge = 1.0 - abs(2.0 * n - 1.0);
        detail += (ridge * ridge - 0.5) * amplitude * weight;
        frequency *= 2.0;
        amplitude *= 0.5;
    }
    return amplitudeScale * (broadHeight * 0.75 + detail * 0.7);
}
