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
    skyDiffuse: vec4f, // RGBは固定アルベド、WはSH Diffuse強度。
    cameraPosition: vec4f, // ワールドカメラXYZ、Wは予約。
    atmosphere: vec4f, // 大気遠近法有効、基準高度、固定アルベド有効、予約。
    shadowMatrices: array<mat4x4f,4>,
    splits: vec4f,
    viewForward: vec4f,
    material: vec4f, // roughness、metallic、Specular IBL有効、CSM色分け。
}
@group(1) @binding(0) var<uniform> lighting: Lighting;
@group(1) @binding(1) var shadowMap: texture_depth_2d;
@group(1) @binding(2) var shadowSampler: sampler_comparison;
@group(1) @binding(3) var<uniform> skySH: SkySH;
@group(1) @binding(4) var<uniform> cameraFrame: CameraFrame;
@group(1) @binding(5) var specularMap: texture_2d<f32>;
@group(1) @binding(6) var brdfMap: texture_2d<f32>;
@group(1) @binding(7) var brdfSampler: sampler;

// 標高キャッシュの段を識別する固定色。メッシュLOD0/1は同じ標高段0の色となる。
fn heightCascadeColor(layer: u32) -> vec3f {
    let colors = array<vec3f, 7>(
        vec3f(0.85, 0.18, 0.15), vec3f(0.95, 0.55, 0.10),
        vec3f(0.75, 0.85, 0.12), vec3f(0.12, 0.75, 0.32),
        vec3f(0.10, 0.65, 0.90), vec3f(0.32, 0.25, 0.90), vec3f(0.80, 0.15, 0.65));
    return colors[min(layer, 6u)];
}

@vertex
fn vertexMain(@builtin(vertex_index) id: u32, @builtin(instance_index) instance: u32) -> VertexOutput {
    let surface = terrainVertex(id, instance);
    if (scene.domain.w != 0.0 || scene.terrain.w != 0.0) {
        // 診断時は法線属性を色として再利用し、補間属性を増やさない。法線用の標高参照も省く。
        let color = mix(heightCascadeColor(surface.layer), heightCascadeColor(surface.coarseLayer), surface.weight);
        // 診断では高さ属性を混合率、タイルID属性をpacked descriptorとして再利用する。
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
fn cascadeIndex(position: vec3f) -> u32 {
    let depth=dot(position,lighting.viewForward.xyz)+lighting.viewForward.w;
    return u32(depth>lighting.splits.x)+u32(depth>lighting.splits.y)+u32(depth>lighting.splits.z);
}
fn sampleShadowCascade(position: vec3f,normal: vec3f,cascade: u32) -> f32 {
    let clip=lighting.shadowMatrices[cascade]*vec4f(position+normal*lighting.shadow.z,1);
    let local=clip.xy*vec2f(0.5,-0.5)+0.5;
    if(any(local<vec2f(0)) || any(local>vec2f(1)) || clip.z<0.0 || clip.z>1.0) { return 1.0; }
    let origin=vec2f(f32(cascade%2u),f32(cascade/2u))*0.5;
    let radius=i32(lighting.shadowFilter.x);var sum=0.0;
    for(var y=-radius;y<=radius;y++) { for(var x=-radius;x<=radius;x++) {
        // PCFの全tapを自段の内部へ制限し、Atlas隣接段の深度を混入させない。
        let uv=origin+clamp(local+vec2f(f32(x),f32(y))/1024.0,vec2f(0.5/1024.0),vec2f(1.0-0.5/1024.0))*0.5;
        sum+=textureSampleCompareLevel(shadowMap,shadowSampler,uv,clip.z+lighting.shadow.y);
    }
    }
    let width=f32(2*radius+1);return sum/(width*width);
}
fn shadowVisibility(position: vec3f, normal: vec3f) -> f32 {
    if(lighting.shadow.x==0.0) { return 1.0; }
    let depth=dot(position,lighting.viewForward.xyz)+lighting.viewForward.w;
    if(depth>lighting.splits.w) { return 1.0; }
    let cascade=cascadeIndex(position);
    let visibility=sampleShadowCascade(position,normal,cascade);
    if(cascade>=3u) { return visibility; }
    let start=select(1.0,lighting.splits[max(cascade,1u)-1u],cascade>0u);
    let end=lighting.splits[cascade];let weight=smoothstep(mix(start,end,0.9),end,depth);
    if(weight<=0.0) { return visibility; }
    return mix(visibility,sampleShadowCascade(position,normal,cascade+1u),weight);
}

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
    if(lighting.material.w!=0.0) {
        return vec4f(preExposeRadiance(heightCascadeColor(cascadeIndex(input.worldPosition)),cameraFrame),1);
    }
    let n = normalize(input.normal);
    if (scene.elevation.z != 0.0) { return vec4f(preExposeRadiance(n * 0.5 + 0.5, cameraFrame), 1.0); }
    let visibility = shadowVisibility(input.worldPosition, n);
    if (lighting.shadowFilter.y != 0.0) { return vec4f(preExposeRadiance(vec3f(visibility), cameraFrame), 1.0); }
    let t = clamp((input.height - scene.elevation.x) * scene.elevation.y, 0.0, 1.0);
    if (scene.elevation.w != 0.0) { return vec4f(preExposeRadiance(tileColor(input.tileID), cameraFrame), 1.0); }
    // アルベドはリニア反射率。表示用sRGB値として扱わない。
    // 固定値はsRGB色ではなくリニア反射率。1は白色Lambert面、0は黒色面。
    let albedo = select(vec3f(mix(0.16, 0.94, t)), lighting.skyDiffuse.xyz, lighting.atmosphere.z != 0.0);
    // 直射光のLambert反射。Shadow Mapの可視率はこの直射光だけへ適用する。
    let relative = input.worldPosition - lighting.cameraPosition.xyz;
    let observerHeight = max(lighting.cameraPosition.y + lighting.atmosphere.y, 2.0);
    let origin = vec3f(0.0, EARTH_RADIUS + observerHeight, 0.0);
    let point = origin + relative;
    let sunT = solarTransmittance(point, lighting.light.xyz);
    let v=normalize(lighting.cameraPosition.xyz-input.worldPosition);
    let roughness=max(lighting.material.x,0.04);let metallic=lighting.material.y;
    let f0=mix(vec3f(0.04),albedo,metallic);
    let direct=directBRDF(n,v,lighting.light.xyz,albedo,roughness,metallic)*lighting.light.w*sunT*visibility;
    // GPUで投影・Lambert畳み込みした2次SHを、ワールド空間の法線で評価する。
    let noV=max(dot(n,v),0.0001);
    let f=fresnelSchlick(noV,f0);
    let skyDiffuse=(vec3f(1.0)-f)*(1.0-metallic)*albedo*evaluateSkySH(skySH,n)*lighting.skyDiffuse.w;
    let dfg=textureSampleLevel(brdfMap,brdfSampler,vec2f(noV,roughness),0.0).rg;
    let reflected=reflect(-v,n);
    let specularIBL=sampleOctRoughness(specularMap,brdfSampler,reflected,roughness)*(f0*dfg.x+dfg.y)*lighting.skyDiffuse.w*lighting.material.z;
    // 直接光とSkyLightをシーンリニアHDRで加算する。1を超える値を保持する。
    var linearHdr = direct + skyDiffuse + specularIBL;
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
