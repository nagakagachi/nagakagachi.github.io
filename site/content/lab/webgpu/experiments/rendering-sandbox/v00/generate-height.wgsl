struct HeightJob {
    rect: vec4i, // 世界格子での原点X/Zと矩形の幅/高さ。
    config: vec4u, // 標高段、uintシード、予約、予約。
    shape: vec4f, // サンプル間隔、標高振幅、山のスケール、予約。
}
@group(0) @binding(0) var<uniform> job: HeightJob;
@group(0) @binding(1) var<storage, read_write> heights: array<u32>;

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

fn terrainHeight(worldXZ: vec2f) -> f32 {
    let scale = job.shape.z;
    let seed = job.config.y;
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
        let weight = 1.0 - smoothstep(0.0625, 0.125, job.shape.x * frequency);
        if (weight <= 0.0) { break; }
        let n = valueNoise(p * frequency, seed + 101u + octave * 17u);
        let ridge = 1.0 - abs(2.0 * n - 1.0);
        detail += (ridge * ridge - 0.5) * amplitude * weight;
        frequency *= 2.0;
        amplitude *= 0.5;
    }
    return job.shape.y * (broadHeight * 0.75 + detail * 0.7);
}

@compute @workgroup_size(8, 8)
fn generateMain(@builtin(global_invocation_id) gid: vec3u) {
    if (gid.x >= u32(job.rect.z) / 2u || gid.y >= u32(job.rect.w)) { return; }
    let cell = job.rect.xy + vec2i(i32(gid.x * 2u), i32(gid.y));
    let first = terrainHeight(vec2f(cell) * job.shape.x);
    let second = terrainHeight(vec2f(cell + vec2i(1, 0)) * job.shape.x);
    let physical = vec2u(cell) & vec2u(1023u);
    let word = job.config.x * 524288u + physical.y * 512u + physical.x / 2u;
    // 2個のFP16を1語として書く。他の矩形・invocationと書込先が重ならず、Atomic不要。
    heights[word] = pack2x16float(vec2f(first, second));
}
