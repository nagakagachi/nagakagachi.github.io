struct VertexOutput {
    @builtin(position) @invariant clip: vec4f,
    @location(0) normal: vec3f,
    @location(1) height: f32,
    @location(2) @interpolate(flat) tileID: u32,
    @location(3) worldPosition: vec3f,
}
struct Lighting {
    shadowViewProjection: mat4x4f,
    light: vec4f, // 地表から光源への方向、直射光強度。
    shadow: vec4f, // 有効、比較時深度バイアス、法線バイアスm、1/解像度。
    shadowFilter: vec4f, // PCF半径、影の可視化、予約、予約。
    skyDiffuse: vec4f, // XYZは予約、WはSH Diffuseの強度。
    cameraPosition: vec4f, // ワールドカメラXYZ、Wは予約。
    atmosphere: vec4f, // 大気遠近法有効、ワールドY=0の海面高度m、予約。
}
@group(1) @binding(0) var<uniform> lighting: Lighting;
@group(1) @binding(1) var shadowMap: texture_depth_2d;
@group(1) @binding(2) var shadowSampler: sampler_comparison;
@group(1) @binding(3) var<uniform> skySH: SkySH;
@group(1) @binding(4) var<uniform> cameraFrame: CameraFrame;

@vertex
fn vertexMain(@builtin(vertex_index) id: u32, @builtin(instance_index) instance: u32) -> VertexOutput {
    let surface = terrainVertex(id, instance);
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
fn shadowVisibility(position: vec3f, normal: vec3f) -> f32 {
    if (lighting.shadow.x == 0.0) { return 1.0; }
    let offset = position + normal * lighting.shadow.z;
    let clip = lighting.shadowViewProjection * vec4f(offset, 1.0);
    let uv = clip.xy * vec2f(0.5, -0.5) + 0.5;
    let z = clip.z;
    let radius = i32(lighting.shadowFilter.x);
    let margin = (f32(radius) + 1.0) * lighting.shadow.w;
    if (any(uv < vec2f(margin)) || any(uv > vec2f(1.0 - margin)) || z < 0.0 || z > 1.0) {
        return 1.0;
    }
    var sum = 0.0;
    for (var y = -radius; y <= radius; y++) {
        for (var x = -radius; x <= radius; x++) {
            // Reversed Zなので受け手の参照深度を増やして自己遮蔽を緩和する。
            sum += textureSampleCompareLevel(shadowMap, shadowSampler,
                uv + vec2f(f32(x), f32(y)) * lighting.shadow.w, z + lighting.shadow.y);
        }
    }
    let width = f32(2 * radius + 1);
    return sum / (width * width);
}

// 不透明PSにdiscard/clip、深度出力、Storage書込は置かない。
@fragment
fn fragmentMain(input: VertexOutput) -> @location(0) vec4f {
    let n = normalize(input.normal);
    if (scene.elevation.z != 0.0) { return vec4f(preExposeRadiance(n * 0.5 + 0.5, cameraFrame), 1.0); }
    let visibility = shadowVisibility(input.worldPosition, n);
    if (lighting.shadowFilter.y != 0.0) { return vec4f(preExposeRadiance(vec3f(visibility), cameraFrame), 1.0); }
    let t = clamp((input.height - scene.elevation.x) * scene.elevation.y, 0.0, 1.0);
    if (scene.elevation.w != 0.0) { return vec4f(preExposeRadiance(tileColor(input.tileID), cameraFrame), 1.0); }
    // アルベドはリニア反射率。表示用sRGB値として扱わない。
    let albedo = vec3f(mix(0.16, 0.94, t));
    // 直射光のLambert反射。Shadow Mapの可視率はこの直射光だけへ適用する。
    let relative = input.worldPosition - lighting.cameraPosition.xyz;
    let observerHeight = max(lighting.cameraPosition.y + lighting.atmosphere.y, 2.0);
    let origin = vec3f(0.0, EARTH_RADIUS + observerHeight, 0.0);
    let point = origin + relative;
    let sunT = solarTransmittance(point, lighting.light.xyz);
    let direct = lighting.light.w * sunT * max(dot(n, lighting.light.xyz), 0.0) * visibility / 3.14159265;
    // GPUで投影・Lambert畳み込みした2次SHを、ワールド空間の法線で評価する。
    let skyDiffuse = albedo * evaluateSkySH(skySH, n) * lighting.skyDiffuse.w;
    // 直接光とSkyLightをシーンリニアHDRで加算する。1を超える値を保持する。
    var linearHdr = albedo * direct + skyDiffuse;
    if (lighting.atmosphere.x != 0.0) {
        let distance = length(relative);
        if (distance > 0.001) {
            let aerial = integrateAtmosphere(origin, relative / distance, lighting.light.xyz, distance);
            linearHdr = linearHdr * aerial.transmittance + aerial.scattering;
        }
    }
    // Forwardの出力はPreExposure済みの線形HDR。トーンマッピングは後続Passで行う。
    return vec4f(preExposeRadiance(linearHdr, cameraFrame), 1.0);
}
@fragment
fn wireMain() -> @location(0) vec4f {
    return vec4f(preExposeRadiance(vec3f(0.04, 0.055, 0.065), cameraFrame), 1.0);
}
