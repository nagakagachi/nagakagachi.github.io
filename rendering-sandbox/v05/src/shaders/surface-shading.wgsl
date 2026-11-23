struct Lighting {
    shadowViewProjection: mat4x4f,
    light: vec4f, // 地表から光源への方向、直射光強度。
    shadow: vec4f, // 有効、比較時深度バイアスm、法線バイアスm、1/解像度。
    shadowFilter: vec4f, // PCF半径、影の可視化、CSM格子のテクセル間隔（0はOFF）、予約。
    skyDiffuse: vec4f, // RGBは固定アルベド、WはSH Diffuse強度。
    cameraPosition: vec4f, // ワールドカメラXYZ、Wは予約。
    atmosphere: vec4f, // 大気散乱フォグ有効、基準高度、固定アルベド有効、予約。
    shadowMatrices: array<mat4x4f,4>,
    splits: vec4f,
    viewForward: vec4f,
    material: vec4f, // roughness、metallic、Specular IBL有効、CSM色分け。
    inverseViewProjection: mat4x4f,
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

fn cascadeIndex(position: vec3f) -> u32 {
    let depth=dot(position,lighting.viewForward.xyz)+lighting.viewForward.w;
    return u32(depth>lighting.splits.x)+u32(depth>lighting.splits.y)+u32(depth>lighting.splits.z);
}
fn sampleShadowCascade(position: vec3f,normal: vec3f,cascade: u32) -> f32 {
    let clip=lighting.shadowMatrices[cascade]*vec4f(position+normal*lighting.shadow.z,1);
    let local=clip.xy*vec2f(0.5,-0.5)+0.5;
    if(any(local<vec2f(0)) || any(local>vec2f(1)) || clip.z<0.0 || clip.z>1.0) { return 1.0; }
    let origin=vec2f(f32(cascade%2u),f32(cascade/2u))*0.5;
    // バイアスはm単位。カスケードの正射影から深度/距離を求め、PCF全tapで共有する。
    let depthReference=clip.z+lighting.shadow.y*length(vec3f(lighting.shadowMatrices[cascade][0].z,lighting.shadowMatrices[cascade][1].z,lighting.shadowMatrices[cascade][2].z));
    let radius=i32(lighting.shadowFilter.x);var sum=0.0;
    for(var y=-radius;y<=radius;y++) { for(var x=-radius;x<=radius;x++) {
        // PCFの全tapを自段の内部へ制限し、Atlas隣接段の深度を混入させない。
        let uv=origin+clamp(local+vec2f(f32(x),f32(y))/1024.0,vec2f(0.5/1024.0),vec2f(1.0-0.5/1024.0))*0.5;
        sum+=textureSampleCompareLevel(shadowMap,shadowSampler,uv,depthReference);
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

// 不透明サーフェイス共通。材質と法線の作り方は各メッシュ側で決める。
// 直射光・SH/IBL・各シャドウ・大気散乱フォグをまとめ、PreExposure済みHDRを返す。
fn shadeOpaqueSurface(position: vec3f, n: vec3f, albedo: vec3f, roughness: f32, metallic: f32, pixel: vec2f) -> vec4f {
    if ((pscParams.flags.w & 4u) != 0u) {
        return vec4f(preExposeRadiance(polarSurfaceGrid(position), cameraFrame), 1.0);
    }
    if (lighting.material.w != 0.0 || lighting.shadowFilter.z > 0.0) {
        let cascade = cascadeIndex(position);
        let depth = dot(position, lighting.viewForward.xyz) + lighting.viewForward.w;
        let clip = lighting.shadowMatrices[cascade] * vec4f(position, 1.0);
        let uv = clip.xy * vec2f(0.5, -0.5) + 0.5;
        let covered = depth <= lighting.splits.w && all(uv >= vec2f(0.0)) && all(uv <= vec2f(1.0))
            && clip.z >= 0.0 && clip.z <= 1.0;
        var color = select(vec3f(0.65), heightCascadeColor(cascade), lighting.material.w != 0.0);
        if (!covered) { color = vec3f(0.15); }
        // バイアス前の受光位置を各段の1024²テクセル座標へ投影する。
        // 格子は段ごとに独立。切替帯でも混合せず、選択段の密度を表示する。
        if (lighting.shadowFilter.z > 0.0) {
            let cell = uv * (1024.0 / max(lighting.shadowFilter.z, 1.0));
            let footprint = max(fwidth(cell), vec2f(0.0001));
            let distance = abs(fract(cell + 0.5) - 0.5);
            let coverage = 1.0 - smoothstep(vec2f(0.3), vec2f(1.3), distance / footprint);
            let fade = clamp(1.0 - max(footprint.x, footprint.y) * 2.0, 0.0, 1.0);
            let grid = max(coverage.x, coverage.y) * fade * f32(covered);
            color = mix(color, vec3f(0.015), grid);
        }
        return vec4f(preExposeRadiance(color, cameraFrame), 1.0);
    }
    if (scene.elevation.z != 0.0) { return vec4f(preExposeRadiance(n * 0.5 + 0.5, cameraFrame), 1.0); }
    let visibility = min(shadowVisibility(position, n),
        polarShadowVisibility(position));
    if (lighting.shadowFilter.y != 0.0) { return vec4f(preExposeRadiance(vec3f(visibility), cameraFrame), 1.0); }
    let relative = position - lighting.cameraPosition.xyz;
    let observerHeight = max(lighting.cameraPosition.y + lighting.atmosphere.y, 2.0);
    let origin = vec3f(0.0, EARTH_RADIUS + observerHeight, 0.0);
    let point = origin + relative;
    let sunT = solarTransmittance(point, lighting.light.xyz);
    let v=normalize(lighting.cameraPosition.xyz-position);
    let f0=mix(vec3f(0.04),albedo,metallic);
    let direct=directBRDF(n,v,lighting.light.xyz,albedo,roughness,metallic)*lighting.light.w*sunT*visibility;
    // GPUで投影・Lambert畳み込みした2次SHを、ワールド空間の法線で評価する。
    let noV=max(dot(n,v),0.0001);
    let dfg = textureSampleLevel(brdfMap, brdfSampler, vec2f(noV, roughness), 0.0).rg;
    let specularReflectance = iblSpecularReflectance(f0, dfg);
    // 単一散乱GGXの方向別積分を使ったエネルギー配分の近似。多重散乱補償ではない。
    let skyDiffuse = (vec3f(1.0) - specularReflectance) * (1.0 - metallic) * albedo
        * evaluateSkySH(skySH, n) * lighting.skyDiffuse.w;
    let reflected=reflect(-v,n);
    let specularIBL=sampleOctRoughness(specularMap,brdfSampler,reflected,roughness)*specularReflectance*lighting.skyDiffuse.w*lighting.material.z;
    // 直接光とSkyLightをシーンリニアHDRで加算する。1を超える値を保持する。
    var linearHdr = direct + skyDiffuse + specularIBL;
    if (lighting.atmosphere.x != 0.0) {
        let distance = length(relative);
        if (distance > 0.001) {
            let atmosphereFog = integrateAtmosphere(origin, relative / distance, lighting.light.xyz, distance);
            linearHdr = linearHdr * atmosphereFog.transmittance + atmosphereFog.scattering;
        }
    }
    // Forwardの出力はPreExposure済みの線形HDR。トーンマッピングは後続Passで行う。
    return vec4f(preExposeRadiance(linearHdr, cameraFrame), 1.0);
}
