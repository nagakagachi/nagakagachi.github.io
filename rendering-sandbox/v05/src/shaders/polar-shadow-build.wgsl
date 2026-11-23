@group(0) @binding(0) var<uniform> params: PolarShadowParameters;
// sourceDepthはパスに応じてCSM AtlasまたはMainViewDepthを参照する。
// キャッシュ表示の読取りも別エントリーポイントなので同じbindingを使える。
@group(1) @binding(0) var sourceDepth: texture_depth_2d;
@group(1) @binding(0) var cache: texture_2d<f32>;
@group(2) @binding(1) var<storage, read_write> mainDepths: array<atomic<u32>>;
@group(2) @binding(2) var<storage, read> previousDepths: array<u32>;
@group(2) @binding(3) var<uniform> previous: PolarShadowParameters;
@group(2) @binding(0) var outputMap: texture_storage_2d<r32float, write>;
fn cacheLocal(uv: vec2f) -> vec2f {
    let theta = select((uv.x * 2.0 - 1.0) * params.ellipse.w, uv.x * 2.0 * PSC_PI, params.right.w < 0.5);
    let radius = mix(params.mapping.x, pscRadiusLimit(params, theta), uv.y * uv.y);
    return radius * vec2f(cos(theta), sin(theta));
}

fn localToWorld(local: vec2f) -> vec3f {
    return params.camera.xyz + params.camera.w * (params.right.xyz * local.x + params.up.xyz * local.y);
}

@compute @workgroup_size(8, 8)
fn buildCache(@builtin(global_invocation_id) id: vec3u) {
    let size = textureDimensions(outputMap);
    if (any(id.xy >= size)) { return; }
    let uv = (vec2f(id.xy) + 0.5) / vec2f(size);
    let world = localToWorld(cacheLocal(uv));
    let key = atomicLoad(&mainDepths[id.y * size.x + id.x]);
    var nearest = bitcast<f32>(key);
    if ((params.flags.w & 8u) != 0u) {
        nearest = f32(key >> 12u) / DEPTH_UNITS;
    }
    if (params.flags.x != 0u) {
        for (var i = 0u; i < 4u; i++) {
            let matrix = params.shadows[i];
            let clip = matrix * vec4f(world, 1.0);
            let local = clip.xy * vec2f(0.5, -0.5) + 0.5;
            if (any(local < vec2f(0)) || any(local >= vec2f(1))) { continue; }
            let origin = vec2i(i32(i % 2u), i32(i / 2u)) * 1024;
            let depth = textureLoad(sourceDepth, origin + vec2i(local * 1024.0), 0);
            if (depth > 0.0) {
                let scale = length(vec3f(matrix[0].z, matrix[1].z, matrix[2].z));
                // カメラ位置のライト軸深度を0.5とする共通のReversed Z。
                let commonDepth = clamp(0.5 + (depth - clip.z) / (scale * params.light.w), 0.0, 1.0);
                nearest = max(nearest, commonDepth);
            }
        }
    }
    // 全ソースを最近点で合成する。無効・範囲外・空のセルは最遠の0。
    textureStore(outputMap, vec2i(id.xy), vec4f(nearest, 0, 0, 0));
}

// 上位20ビットで影判定用の深度を比較し、下位12ビットに補正量を対数圧縮して保持する。
const DEPTH_UNITS: f32 = 1048575.0;
const OFFSET_MASK: u32 = 4095u;
const MAX_OFFSET_METERS: f32 = 8192.0;

fn unpackHistoryOffset(key: u32, span: f32) -> f32 {
    let encoded = f32(OFFSET_MASK - (key & OFFSET_MASK)) / f32(OFFSET_MASK);
    return (exp2(encoded * log2(1.0 + MAX_OFFSET_METERS)) - 1.0) / span;
}

fn packHistoryDepth(raw: f32, offset: f32) -> u32 {
    let meters = max(offset, 0.0) * params.light.w;
    if (raw <= 0.0 || raw > 1.0 || meters > MAX_OFFSET_METERS) { return 0u; }
    let encoded = u32(max(0.0, ceil(log2(1.0 + meters) / log2(1.0 + MAX_OFFSET_METERS) * f32(OFFSET_MASK) - 0.001)));
    let quantizedOffset = unpackHistoryOffset(OFFSET_MASK - encoded, params.light.w);
    if (raw <= quantizedOffset) { return 0u; }
    let depthUnits = u32(round((raw - quantizedOffset) * DEPTH_UNITS));
    return (depthUnits << 12u) | (OFFSET_MASK - encoded);
}

// 復元位置の近傍すべてで手前にある場合だけ、観測された空間として除去する。
fn historyIsAbsent(clip: vec4f, tolerance: f32) -> bool {
    let sourceSize = vec2i(textureDimensions(sourceDepth));
    let screenUV = clip.xy / clip.w * vec2f(0.5, -0.5) + 0.5;
    let pixel = vec2i(screenUV * vec2f(sourceSize));
    let limit = 1.0 / (clip.w + tolerance);
    for (var y = -1; y <= 1; y++) {
        for (var x = -1; x <= 1; x++) {
            let neighbor = clamp(pixel + vec2i(x, y), vec2i(0), sourceSize - 1);
            if (textureLoad(sourceDepth, neighbor, 0) >= limit) { return false; }
        }
    }
    return true;
}

@compute @workgroup_size(8, 8)
fn reprojectHistory(@builtin(global_invocation_id) id: vec3u) {
    let size = textureDimensions(outputMap);
    if (any(id.xy >= size)) { return; }
    let key = previousDepths[id.y * size.x + id.x];
    if (key == 0u) { return; }

    let oldOffset = unpackHistoryOffset(key, previous.light.w);
    let oldRaw = f32(key >> 12u) / DEPTH_UNITS + oldOffset;
    let uv = (vec2f(id.xy) + 0.5) / vec2f(size);
    let theta = uv.x * 2.0 * PSC_PI;
    let radius = mix(previous.mapping.x, 1.0, uv.y * uv.y) * previous.camera.w;
    let world = previous.camera.xyz
        + radius * (previous.right.xyz * cos(theta) + previous.up.xyz * sin(theta))
        + previous.light.xyz * ((oldRaw - 0.5) * previous.light.w);
    let relative = world - params.camera.xyz;
    let local = vec2f(dot(relative, params.right.xyz), dot(relative, params.up.xyz)) / params.camera.w;
    let projected = pscLocalUV(params, local);
    if (projected.z < 0.5) { return; }

    var offset = oldOffset * previous.light.w / params.light.w;
    let clip = params.viewProjection * vec4f(world, 1.0);
    if (clip.w > 0.0 && all(abs(clip.xy) < vec2f(clip.w)) && clip.z <= clip.w) {
        // 旧セル中心を使った復元誤差を、旧セルの半径幅と円弧幅から見積もる。
        let dr = 2.0 * uv.y * (1.0 - previous.mapping.x) * previous.camera.w / f32(size.y);
        let arc = radius * 2.0 * PSC_PI / f32(size.x);
        let tolerance = 0.5 + 0.5 * length(vec2f(dr, arc));
        if (historyIsAbsent(clip, tolerance)) { return; }
        offset += params.history.w;
    }

    let raw = 0.5 + dot(relative, params.light.xyz) / params.light.w;
    let candidate = packHistoryDepth(raw, offset);
    let cell = min(vec2u(projected.xy * vec2f(size)), size - 1u);
    if (candidate != 0u) { atomicMax(&mainDepths[cell.y * size.x + cell.x], candidate); }
}

fn cacheRelative(pixel: vec2u, size: vec2u, raw: f32) -> vec3f {
    let ndc = ((vec2f(pixel) + 0.5) / vec2f(size) * 2.0 - 1.0) * vec2f(1, -1);
    let h = params.inverseViewProjection * vec4f(ndc, raw, 1);
    return h.xyz / h.w - params.camera.xyz;
}

fn cacheCasterBias(pixel: vec2u, size: vec2u, relative: vec3f, uv: vec3f) -> f32 {
    let maximum = params.mapping.z;
    if (maximum <= 0.0) { return 0.0; }
    let local = vec2f(dot(relative, params.right.xyz), dot(relative, params.up.xyz));
    let radius = length(local);
    let radial = local / max(radius, 1e-7);
    let tangent = vec2f(-radial.y, radial.x);
    let resolution = vec2f(textureDimensions(outputMap));
    let row = floor(uv.y * resolution.y) / resolution.y;
    let next = row + 1.0 / resolution.y;
    let theta = select(0.0, atan2(local.y, local.x), radius > 1e-7);
    // 両モードの半径写像と実際のセル寸法から同じ補正を計算する。
    let dr = params.camera.w * (pscRadiusLimit(params, theta) - params.mapping.x) * (next * next - row * row);
    let arc = (radius + dr) * (2.0 * params.ellipse.w) / resolution.x;
    // 面の傾きが取得できない輪郭でも、遠方セルの量子化幅に比例して押し込む。
    let fallback = min(params.mapping.y + params.mapping.w * 0.25 * max(dr, arc), maximum);
    let x = pixel + vec2u(1, 0);
    let y = pixel + vec2u(0, 1);
    if (x.x >= size.x || y.y >= size.y) { return fallback; }
    let rx = textureLoad(sourceDepth, vec2i(x), 0);
    let ry = textureLoad(sourceDepth, vec2i(y), 0);
    if (min(rx, ry) <= 0.0) { return fallback; }
    let tx = cacheRelative(x, size, rx) - relative;
    let ty = cacheRelative(y, size, ry) - relative;
    let maxEdge = 8.0 * length(relative) / f32(min(size.x, size.y));
    if (max(length(tx), length(ty)) > maxEdge) { return fallback; }
    let n = cross(tx, ty);
    let normal = vec3f(dot(n, params.right.xyz), dot(n, params.up.xyz), dot(n, params.light.xyz));
    let magnitude = length(normal);
    if (magnitude <= 1e-8) { return fallback; }
    let rise = abs(dot(normal.xy, radial)) * dr + abs(dot(normal.xy, tangent)) * arc;
    return min(maximum, fallback + params.mapping.w * rise / max(abs(normal.z), magnitude * 0.001));
}

// MainViewDepthの可視サーフェイスだけをライト平面へ前方投影する。
// 空は書き込まず、正のReversed Zのビット列をAtomicMaxで比較する。
fn mainCandidate(pixel: vec2u, size: vec2u) -> vec2u {
    let raw = textureLoad(sourceDepth, vec2i(pixel), 0);
    if (raw <= 0.0) { return vec2u(0xffffffffu, 0u); }
    let ndc = ((vec2f(pixel) + 0.5) / vec2f(size) * 2.0 - 1.0) * vec2f(1, -1);
    let homogeneous = params.inverseViewProjection * vec4f(ndc, raw, 1);
    let relative = homogeneous.xyz / homogeneous.w - params.camera.xyz;
    let local = vec2f(dot(relative, params.right.xyz), dot(relative, params.up.xyz)) / params.camera.w;
    let uv = pscLocalUV(params, local);
    let bias = cacheCasterBias(pixel, size, relative, uv);
    let depth = 0.5 + (dot(relative, params.light.xyz) - bias) / params.light.w;
    if (uv.z < 0.5 || depth <= 0.0 || depth > 1.0) { return vec2u(0xffffffffu, 0u); }
    let cacheSize = textureDimensions(outputMap);
    let cell = clamp(vec2u(uv.xy * vec2f(cacheSize)), vec2u(0), cacheSize - 1u);
    var key = bitcast<u32>(depth);
    if ((params.flags.w & 8u) != 0u) {
        let rawDepth = 0.5 + dot(relative, params.light.xyz) / params.light.w;
        key = packHistoryDepth(rawDepth, bias / params.light.w);
    }
    return vec2u(cell.y * cacheSize.x + cell.x, key);
}

@compute @workgroup_size(8, 8)
fn scatterMain(@builtin(global_invocation_id) id: vec3u) {
    let size = textureDimensions(sourceDepth);
    var candidate = vec2u(0xffffffffu, 0u);
    if (all(id.xy < size)) { candidate = mainCandidate(id.xy, size); }
    //INSERT_SUBGROUP
    if (candidate.x != 0xffffffffu) { atomicMax(&mainDepths[candidate.x], candidate.y); }
}

struct DebugVertex {
    @builtin(position) position: vec4f,
    @location(0) local: vec2f,
}

@vertex
fn worldVertex(@builtin(vertex_index) id: u32) -> DebugVertex {
    let corner = id % 6u;
    let corners = array<vec2f, 6>(vec2f(0,0), vec2f(1,0), vec2f(1,1), vec2f(0,0), vec2f(1,1), vec2f(0,1));
    let q = corners[corner];
    let u = (f32(id / 6u) + q.x) / 256.0;
    let local = cacheLocal(vec2f(u, q.y));
    let world = localToWorld(local) - params.light.xyz * params.display.x;
    return DebugVertex(params.viewProjection * vec4f(world, 1), local);
}

@vertex
fn overlayVertex(@builtin(vertex_index) id: u32) -> DebugVertex {
    let xy = vec2f(f32((id << 1u) & 2u), f32(id & 2u));
    return DebugVertex(vec4f(xy * 2.0 - 1.0, 0, 1), vec2f(xy.x, 1.0 - xy.y));
}

fn debugColor(uv: vec2f) -> vec3f {
    let size = textureDimensions(cache);
    let cell = clamp(vec2i(uv * vec2f(size)), vec2i(0), vec2i(size) - 1);
    let depth = textureLoad(cache, cell, 0).r;
    let grid = uv * vec2f(size) / 16.0;
    // 全周モードの継ぎ目では差分を折り返して格子の肥大を防ぐ。
    var dx = dpdx(uv);
    var dy = dpdy(uv);
    if (params.ellipse.w >= PSC_PI) {
        dx.x -= round(dx.x);
        dy.x -= round(dy.x);
    }
    let width = max((abs(dx) + abs(dy)) * vec2f(size) / 16.0, vec2f(0.001));
    let edge = abs(fract(grid + 0.5) - 0.5);
    let line = (1.0 - smoothstep(vec2f(0.3), vec2f(1.3), edge / width))
        * clamp(1.0 - width * 2.0, vec2f(0), vec2f(1));
    return mix(vec3f(depth), vec3f(0.05, 0.55, 0.75),
        max(line.x, line.y) * f32(params.flags.z != 0u));
}

@fragment
fn worldFragment(input: DebugVertex) -> @location(0) vec4f {
    let uv = pscLocalUV(params, input.local);
    return vec4f(debugColor(uv.xy) * params.display.z, 1);
}

@fragment
fn overlayFragment(input: DebugVertex) -> @location(0) vec4f {
    let local = (input.local - 0.5) * vec2f(2, -2) * params.display.y;
    let projected = pscLocalUV(params, local);
    let uv = select(vec3f(input.local, 1), projected, params.flags.y != 0u);
    // 微分は外形マスクの分岐より先に評価する。
    let color = debugColor(uv.xy);
    return vec4f(select(vec3f(0.025), color, uv.z > 0.5), 1);
}
