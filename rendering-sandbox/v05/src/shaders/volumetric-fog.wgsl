//CACHE_VARIANT
struct FogParameters {
    rays: array<vec4f, 3>,
    sun: vec4f,
    source: vec4f,
    medium: vec4f,
    options: vec4u,
}
@group(0) @binding(0) var<uniform> fog: FogParameters;
@group(0) @binding(1) var mainDepth: texture_depth_2d;
// 構築と合成は別パイプラインで、それぞれ書込用・読取用のレイアウトを使う。
@group(0) @binding(2) var fogOutput: texture_storage_2d<rgba16float, write>;
@group(0) @binding(3) var guideOutput: texture_storage_2d<r32float, write>;
@group(0) @binding(2) var fogInput: texture_2d<f32>;
@group(0) @binding(3) var guideInput: texture_2d<f32>;
@group(1) @binding(0) var<uniform> psc: PolarShadowParameters;
@group(1) @binding(1) var pscMap: texture_2d<f32>;

fn pixelRay(pixel: vec2f, size: vec2f) -> vec3f {
    let ndc = (pixel / size * 2.0 - 1.0) * vec2f(1, -1);
    return normalize(fog.rays[0].xyz + ndc.x * fog.rays[1].xyz + ndc.y * fog.rays[2].xyz);
}

@compute @workgroup_size(8, 8)
fn integrateFog(@builtin(global_invocation_id) id: vec3u) {
    let size = textureDimensions(fogOutput);
    if (any(id.xy >= size)) { return; }
    let fullSize = textureDimensions(mainDepth);
    let pixel = min(vec2u((vec2f(id.xy) + 0.5) * vec2f(fullSize) / vec2f(size)), fullSize - 1u);
    let ray = pixelRay(vec2f(pixel) + 0.5, vec2f(fullSize));
    let raw = textureLoad(mainDepth, vec2i(pixel), 0);
    let viewDepth = select(1e8, 1.0 / max(raw, 1e-8), raw > 0.0);
    let distance = min(fog.medium.y, viewDepth / max(dot(ray, fog.rays[0].xyz), 1e-5));

    let cosine = clamp(dot(ray, fog.sun.xyz), -1.0, 1.0);
    let g = fog.medium.z;
    let phase = (1.0 - g * g) / (12.56637061 * pow(max(1.0 + g * g - 2.0 * g * cosine, 1e-4), 1.5));
    let source = fog.medium.w * phase * fog.source.rgb;
    let analyticT = exp(-fog.medium.x * distance);
    textureStore(guideOutput, vec2i(id.xy), vec4f(viewDepth, 0, 0, 0));
    // 遮蔽OFFや密度0は解析解で完了し、キャッシュを読まない。
    if (fog.options.y == 0u || fog.medium.x <= 0.0) {
        textureStore(fogOutput, vec2i(id.xy), vec4f((1.0 - analyticT) * source, analyticT));
        return;
    }

    // 履歴用のディスク中心がカメラから離れると、視線上で角度も変わる。
    if (any(psc.history.xyz != vec3f(0.0))) {
        let count = f32(fog.options.x);
        let sizeCache = textureDimensions(pscMap);
        let step = distance / count;
        let segmentT = exp(-fog.medium.x * step);
        var transmittance = 1.0;
        var scattering = vec3f(0.0);
        for (var i = 0u; i < fog.options.x; i++) {
            let relative = psc.history.xyz + ray * ((f32(i) + 0.5) * step);
            let local = vec2f(dot(relative, psc.right.xyz), dot(relative, psc.up.xyz)) / psc.camera.w;
            let uv = pscLocalUV(psc, local);
            let depth = dot(relative, psc.light.xyz) / psc.light.w;
            var visibility = 1.0;
            if (uv.z > 0.5 && abs(depth) <= 0.5) {
                let cell = min(vec2u(uv.xy * vec2f(sizeCache)), sizeCache - 1u);
                let blocker = textureLoad(pscMap, vec2i(cell), 0).r;
                visibility = select(1.0, 0.0, blocker > 0.5 + depth + psc.display.w / psc.light.w);
            }
            scattering += transmittance * (1.0 - segmentT) * source * visibility;
            transmittance *= segmentT;
        }
        textureStore(fogOutput, vec2i(id.xy), vec4f(scattering, transmittance));
        return;
    }

    // 両ソースともライト平面上の投影は直線。Uを固定し、Vだけを等間隔で走査する。
    var start = 0.0;
    var end = distance;
    var endV = 0.0;
    var u = 0.0;
    var slope = 0.0;
    var bias = 0.0;
    var coveredAngle = true;
    var cacheSize = vec2u(1);
    if (FOG_FULL_DISK) {
        let projected = vec2f(dot(ray, psc.right.xyz), dot(ray, psc.up.xyz));
        let radius = length(projected);
        let theta = select(0.0, atan2(projected.y, projected.x), radius > 1e-7);
        let inner = psc.mapping.x * psc.camera.w;
        let outer = psc.camera.w;
        start = min(distance, inner / max(radius, 1e-8));
        end = min(distance, outer / max(radius, 1e-8));
        endV = sqrt(max((radius * end - inner) / (outer - inner), 0.0));
        u = fract(theta / 6.283185307);
        slope = dot(ray, psc.light.xyz) / psc.light.w;
        bias = psc.display.w / psc.light.w;
        cacheSize = textureDimensions(pscMap);
    } else {
        let projected = vec2f(dot(ray, psc.right.xyz), dot(ray, psc.up.xyz));
        let radius = length(projected);
        let theta = select(0.0, atan2(projected.y, projected.x), radius > 1e-7);
        let limit = pscRadiusLimit(psc, theta);
        endV = sqrt(max(radius * distance / max(psc.camera.w * limit, 1e-7), 0.0));
        u = theta / (2.0 * psc.ellipse.w) + 0.5;
        slope = dot(ray, psc.light.xyz) / psc.light.w;
        bias = psc.display.w / psc.light.w;
        coveredAngle = abs(theta) <= psc.ellipse.w + 1e-5;
        cacheSize = textureDimensions(pscMap);
    }
    if (!coveredAngle || end <= start) {
        textureStore(fogOutput, vec2i(id.xy), vec4f((1.0 - analyticT) * source, analyticT));
        return;
    }
    let cacheX = clamp(i32(u * f32(cacheSize.x)), 0, i32(cacheSize.x) - 1);
    // PSCの内半径以前・外半径以遠は非遮蔽として解析積分する。
    var transmittance = exp(-fog.medium.x * start);
    var scattering = (1.0 - transmittance) * source;
    let jitter = fract(52.9829189 * fract(dot(vec2f(pixel), vec2f(0.06711056, 0.00583715))));
    let count = f32(fog.options.x);
    let a = (end - start) / (count * count);
    let texelStep = endV * f32(cacheSize.y) / count;
    var texelY = texelStep * jitter;
    // t(n)=start+a*(n+jitter)^2。比較深度を一次差分・二次差分で更新する。
    var lightDepth = slope * (start + a * jitter * jitter);
    var depthStep = slope * a * (2.0 * jitter + 1.0);
    let depthAcceleration = 2.0 * slope * a;
    // 区間長a*(2n+1)に対応する透過率。指数関数はループ外の2回だけ。
    var segmentT = exp(-fog.medium.x * a);
    let segmentRatio = exp(-2.0 * fog.medium.x * a);
    for (var i = 0u; i < fog.options.x; i++) {
        var visibility = 1.0;
        if (texelY <= f32(cacheSize.y) && abs(lightDepth) <= 0.5) {
            let y = clamp(i32(texelY), 0, i32(cacheSize.y) - 1);
            let blocker = textureLoad(pscMap, vec2i(cacheX, y), 0).r;
            visibility = select(1.0, 0.0, blocker > 0.5 + lightDepth + bias);
        }
        scattering += transmittance * (1.0 - segmentT) * source * visibility;
        transmittance *= segmentT;
        segmentT *= segmentRatio;
        texelY += texelStep;
        lightDepth += depthStep;
        depthStep += depthAcceleration;
    }
    let suffixT = exp(-fog.medium.x * (distance - end));
    scattering += transmittance * (1.0 - suffixT) * source;
    transmittance *= suffixT;
    // 光源側の追加フォグ透過率、多重散乱、SkyLight散乱は初版では省略する。
    textureStore(fogOutput, vec2i(id.xy), vec4f(scattering, transmittance));
    textureStore(guideOutput, vec2i(id.xy), vec4f(viewDepth, 0, 0, 0));
}

@vertex
fn fogVertex(@builtin(vertex_index) id: u32) -> @builtin(position) vec4f {
    let xy = vec2f(f32((id << 1u) & 2u), f32(id & 2u));
    return vec4f(xy * 2.0 - 1.0, 0, 1);
}

@fragment
fn compositeFog(@builtin(position) pixel: vec4f) -> @location(0) vec4f {
    let fullSize = textureDimensions(mainDepth);
    let raw = textureLoad(mainDepth, vec2i(pixel.xy), 0);
    let targetDepth = select(1e8, 1.0 / max(raw, 1e-8), raw > 0.0);
    let size = vec2i(textureDimensions(fogInput));
    let xy = pixel.xy / vec2f(fullSize) * vec2f(size) - 0.5;
    let base = vec2i(floor(xy));
    let f = fract(xy);
    var result = vec4f(0);
    var sum = 0.0;
    var closest = vec4f(0, 0, 0, 1);
    var minimum = 1e30;
    for (var y = 0; y < 2; y++) {
        for (var x = 0; x < 2; x++) {
            let cell = clamp(base + vec2i(x, y), vec2i(0), size - 1);
            let guide = textureLoad(guideInput, cell, 0).r;
            let value = textureLoad(fogInput, cell, 0);
            let delta = abs(guide - targetDepth);
            if (delta < minimum) { minimum = delta; closest = value; }
            let bilinear = select(1.0 - f.x, f.x, x == 1) * select(1.0 - f.y, f.y, y == 1);
            let weight = bilinear * exp(-delta / max(1.0, targetDepth * 0.02));
            result += value * weight;
            sum += weight;
        }
    }
    // 深度境界で全候補の重みが消えた場合は、深度が最も近い候補を使う。
    return select(closest, result / max(sum, 1e-8), sum > 1e-6);
}
