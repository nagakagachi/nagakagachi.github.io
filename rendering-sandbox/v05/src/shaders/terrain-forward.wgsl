struct VertexOutput {
    @builtin(position) @invariant clip: vec4f,
    @location(0) normal: vec3f,
    @location(1) height: f32,
    @location(2) @interpolate(flat) tileID: u32,
    @location(3) worldPosition: vec3f,
}
@vertex
fn vertexMain(@builtin(vertex_index) id: u32, @builtin(instance_index) instance: u32) -> VertexOutput {
    let surface = terrainVertex(id, instance);
    if (scene.domain.w != 0.0 || scene.terrain.w != 0.0) {
        // デバッグ時は法線属性を色として再利用し、補間属性を増やさない。法線用の標高参照も省く。
        let color = mix(heightCascadeColor(surface.layer), heightCascadeColor(surface.coarseLayer), surface.weight);
        // デバッグでは高さ属性を混合率、タイルID属性をpacked descriptorとして再利用する。
        return VertexOutput(surface.clip, color, surface.weight, visible[instance], vec3f(surface.xz.x, surface.height, surface.xz.y));
    }
    // 外周では法線参照の間隔も粗い段へ合わせ、隣接する段との陰影差を抑える。
    let spacing = mix(f32(1u << surface.layer), f32(1u << surface.coarseLayer), surface.weight);
    let dx = (blendedHeight(surface.xz + vec2f(spacing, 0.0), surface.layer, surface.coarseLayer, surface.weight)
        - blendedHeight(surface.xz - vec2f(spacing, 0.0), surface.layer, surface.coarseLayer, surface.weight)) / (2.0 * spacing);
    let dz = (blendedHeight(surface.xz + vec2f(0.0, spacing), surface.layer, surface.coarseLayer, surface.weight)
        - blendedHeight(surface.xz - vec2f(0.0, spacing), surface.layer, surface.coarseLayer, surface.weight)) / (2.0 * spacing);
    return VertexOutput(surface.clip, normalize(vec3f(-dx, 1.0, -dz)), surface.height, surface.tileID, vec3f(surface.xz.x, surface.height, surface.xz.y));
}

@vertex
fn wireVertexMain(@builtin(vertex_index) id: u32, @builtin(instance_index) instance: u32) -> VertexOutput {
    var surface = terrainVertex(id, instance);
    surface.clip.z *= 1.00001; // Reversed Zでデバッグ線を少し手前へ出す。
    return VertexOutput(surface.clip, vec3f(0.0, 1.0, 0.0), surface.height, surface.tileID, vec3f(surface.xz.x, surface.height, surface.xz.y));
}

fn tileColor(id: u32) -> vec3f {
    var h = id * 747796405u + 2891336453u;
    h = ((h >> ((h >> 28u) + 4u)) ^ h) * 277803737u;
    h = (h >> 22u) ^ h;
    return 0.25 + 0.65 * vec3f(f32(h & 255u), f32((h >> 8u) & 255u), f32((h >> 16u) & 255u)) / 255.0;
}

// 基本の比較サンプルをPCFで平均する。投影範囲外はこの1枚では影を扱わない。
// 世界原点に固定した16テクセル間隔の格子。循環窓の更新でも位相は動かさない。
fn heightGridLine(xz: vec2f, layer: u32) -> f32 {
    let uv = xz / (16.0 * f32(1u << layer));
    let footprint = max(fwidth(uv), vec2f(0.000001));
    let distance = abs(fract(uv + 0.5) - 0.5);
    let coverage = vec2f(1.0) - smoothstep(footprint * 0.5, footprint * 1.5, distance);
    // 画面上で密になりすぎる格子は消し、遠方のちらつきや塗り潰しを抑える。
    let fade = clamp(1.0 - max(footprint.x, footprint.y) * 2.0, 0.0, 1.0);
    return max(coverage.x, coverage.y) * fade;
}

// 不透明PSにdiscard/clip、深度出力、Storage書込は置かない。
@fragment
fn fragmentMain(input: VertexOutput) -> @location(0) vec4f {
    if (scene.domain.w != 0.0 || scene.terrain.w != 0.0) {
        // 法線として正規化せず、標高混合率で補間した段の識別色をそのまま表示する。
        var color = select(vec3f(0.65), input.normal, scene.domain.w != 0.0);
        if (scene.terrain.w != 0.0) {
            let level = (input.tileID >> 19u) & 7u;
            let last = u32(scene.domain.y) - 1u;
            let fine = min(u32(max(i32(level) - 1, 0)), last);
            let coarse = min(level, last);
            // 間隔そのものを連続変化させず、2段の格子を標高と同率で混合する。
            let grid = mix(heightGridLine(input.worldPosition.xz, fine), heightGridLine(input.worldPosition.xz, coarse), input.height);
            color = mix(color, vec3f(0.025), grid * 0.85);
        }
        return vec4f(preExposeRadiance(color, cameraFrame), 1.0);
    }
    let t = clamp((input.height - scene.elevation.x) * scene.elevation.y, 0.0, 1.0);
    if (scene.elevation.w != 0.0) { return vec4f(preExposeRadiance(tileColor(input.tileID), cameraFrame), 1.0); }
    // アルベドはリニア反射率。表示用sRGB値として扱わない。
    let albedo = select(vec3f(mix(0.16, 0.94, t)), lighting.skyDiffuse.xyz, lighting.atmosphere.z != 0.0);
    return shadeOpaqueSurface(input.worldPosition, normalize(input.normal), albedo,
        max(lighting.material.x, 0.04), lighting.material.y, input.clip.xy);
}
@fragment
fn wireMain() -> @location(0) vec4f {
    return vec4f(preExposeRadiance(vec3f(0.04, 0.055, 0.065), cameraFrame), 1.0);
}
