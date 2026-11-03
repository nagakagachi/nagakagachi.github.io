// Uは角度、Vは半径。円盤の位置とキャッシュの座標変換を共有する。
fn polarWorld(local: vec2f) -> vec3f {
    return lighting.cameraPosition.xyz + polarBasis() * vec3f(local, 0.0);
}

fn polarCsmDepth(pixel: vec2f) -> f32 {
    let uv = pixel.xy / vec2f(lighting.polarSampling.xy);
    let angle = POLAR_TAU * uv.x;
    let world = polarWorld(mix(lighting.cameraPosition.w, lighting.polar.x, uv.y * uv.y) * vec2f(cos(angle), sin(angle)));
    var nearest = 0.0;
    for (var i = 0u; i < 4u; i++) {
        let matrix = lighting.shadowMatrices[i];
        let clip = matrix * vec4f(world, 1);
        let local = clip.xy * vec2f(0.5, -0.5) + 0.5;
        if (any(local < vec2f(0)) || any(local >= vec2f(1))) {
            continue;
        }
        let offset = vec2i(i32(i % 2u), i32(i / 2u)) * 1024;
        let raw = textureLoad(shadowMap, offset + vec2i(local * 1024.0), 0);
        if (raw > 0.0) {
            // 段ごとのReversed Zを、カメラ基準の光軸上の距離[m]に揃える。
            let scale = length(vec3f(matrix[0].z, matrix[1].z, matrix[2].z));
            // 共通の光軸範囲はカメラ基準で -16 km ～ +16 km。正方向が光源側。
            let polarDepth = clamp(0.5 + (raw - clip.z) / (scale * POLAR_DEPTH_SPAN), 0.0, 1.0);
            nearest = max(nearest, polarDepth);
        }
    }
    return nearest;
}

struct PolarGridOutput {
    @builtin(position) clip: vec4f,
    @location(0) local: vec2f,
}

@vertex
fn polarGridVertex(@builtin(vertex_index) id: u32) -> PolarGridOutput {
    // 各区画を2三角形で描き、内側にはフラグメントを生成しない。
    let corners = array<vec2u, 6>(
        vec2u(0, 0), vec2u(0, 1), vec2u(1, 1),
        vec2u(0, 0), vec2u(1, 1), vec2u(1, 0),
    );
    let corner = corners[id % 6u];
    let angle = POLAR_TAU * f32(id / 6u + corner.x) / 128.0;
    let radius = select(lighting.cameraPosition.w, lighting.polar.x, corner.y != 0u);
    let local = radius * vec2f(cos(angle), sin(angle));
    let world = polarWorld(local) - lighting.atmosphere.w * normalize(lighting.light.xyz);
    return PolarGridOutput(scene.viewProjection * vec4f(world, 1), local);
}

@fragment
fn polarGridFragment(input: PolarGridOutput) -> @location(0) vec4f {
    let size = vec2f(textureDimensions(polarGridMap));
    let uv = vec2f(
        atan2(input.local.y, input.local.x) / POLAR_TAU,
        sqrt(clamp((length(input.local) - lighting.cameraPosition.w) / (lighting.polar.x - lighting.cameraPosition.w), 0.0, 1.0)),
    );
    return vec4f(preExposeRadiance(polarDebugColor(uv), cameraFrame), 1);
}

fn polarDebugColor(uv: vec2f) -> vec3f {
    let size = vec2f(textureDimensions(polarGridMap));
    // 実テクセル32個ごとに目盛りを描く。
    let grid = uv * size / 32.0;
    let width = max(fwidth(grid), vec2f(0.001));
    let cell = min(vec2i(vec2f(fract(uv.x), uv.y) * size), vec2i(size) - 1);
    let depth = textureLoad(polarGridMap, cell, 0).r;
    let fill = vec3f(depth);
    let edge = abs(fract(grid + 0.5) - 0.5);
    let line = (1.0 - smoothstep(vec2f(0), width, edge)) *
        (1.0 - smoothstep(vec2f(0.35), vec2f(0.9), width));
    let color = mix(fill, vec3f(0.05, 0.55, 0.75), max(line.x, line.y) * lighting.polar.y);
    return color;
}

@vertex
fn polarOverlayVertex(@builtin(vertex_index) id: u32) -> PolarGridOutput {
    let xy = vec2f(f32((id << 1u) & 2u), f32(id & 2u));
    return PolarGridOutput(vec4f(xy * 2.0 - 1.0, 0, 1), vec2f(xy.x, 1.0 - xy.y));
}

@fragment
fn polarOverlayTexture(input: PolarGridOutput) -> @location(0) vec4f {
    return vec4f(polarDebugColor(input.local), 1);
}

@fragment
fn polarOverlayDisk(input: PolarGridOutput) -> @location(0) vec4f {
    let local = (input.local - 0.5) * vec2f(2, -2);
    let radius = length(local);
    // キャッシュの最内周を表示上の中心へ詰める。
    let uv = vec2f(atan2(local.y, local.x) / POLAR_TAU, sqrt(clamp(radius, 0.0, 1.0)));
    let color = polarDebugColor(uv);
    if (radius > 1.0) {
        discard;
    }
    return vec4f(color, 1);
}

@group(2) @binding(0) var polarMainDepthMap: texture_depth_2d;

fn polarReconstruct(pixel: vec2u, size: vec2u, raw: f32) -> vec3f {
    let screen = (vec2f(pixel) + 0.5) / vec2f(size);
    let ndc = screen * vec2f(2, -2) + vec2f(-1, 1);
    let world = lighting.inverseViewProjection * vec4f(ndc, raw, 1);
    return world.xyz / world.w;
}

fn polarCasterBias(pixel: vec2u, size: vec2u, world: vec3f, basis: mat3x3f,
                   angle: f32, radius: f32, uv: vec2f) -> f32 {
    let limit = lighting.polar.w;
    if (limit <= 0.0) {
        return 0.0;
    }
    let fallback = min(1.0, limit);
    let x = pixel + vec2u(1, 0);
    let y = pixel + vec2u(0, 1);
    if (x.x >= size.x || y.y >= size.y) {
        return fallback;
    }
    let dx = textureLoad(polarMainDepthMap, vec2i(x), 0);
    let dy = textureLoad(polarMainDepthMap, vec2i(y), 0);
    if (min(dx, dy) <= 0.0) {
        return fallback;
    }
    let tx = polarReconstruct(x, size, dx) - world;
    let ty = polarReconstruct(y, size, dy) - world;
    // 画面上の深度段差をまたぐ長い辺は傾きの推定から除く。
    let maxEdge = 8.0 * distance(world, lighting.cameraPosition.xyz) / f32(min(size.x, size.y));
    let normal = transpose(basis) * cross(tx, ty);
    let magnitude = length(normal);
    if (max(length(tx), length(ty)) > maxEdge || magnitude <= 1e-8) {
        return fallback;
    }
    let radial = vec2f(cos(angle), sin(angle));
    let tangent = vec2f(-radial.y, radial.x);
    let resolution = vec2f(lighting.polarSampling.xy);
    let row = floor(uv.y * resolution.y) / resolution.y;
    let next = row + 1.0 / resolution.y;
    let dr = (lighting.polar.x - lighting.cameraPosition.w) * (next * next - row * row);
    let arc = (radius + dr) * POLAR_TAU / resolution.x;
    // セル全幅を使い、浅い入射角での補正量には上限を掛ける。
    let rise = abs(dot(normal.xy, radial)) * dr + abs(dot(normal.xy, tangent)) * arc;
    return min(limit, fallback + rise / max(abs(normal.z), magnitude * 0.001));
}

// メインビューの各深度サンプルを、極座標テクセル中心へ1点として投影する。
fn polarScatterSample(pixel: vec2u, size: vec2u) -> vec2u {
    let raw = textureLoad(polarMainDepthMap, vec2i(pixel), 0);
    let outside = vec2u(0xffffffffu);
    if (raw <= 0.0) {
        return outside;
    }
    let world = polarReconstruct(pixel, size, raw);
    let basis = polarBasis();
    let local = transpose(basis) * (world - lighting.cameraPosition.xyz);
    let radius = length(local.xy);
    let inner = lighting.cameraPosition.w;
    let outer = lighting.polar.x;
    if (radius < inner || radius >= outer) {
        return outside;
    }
    let angle = select(0.0, atan2(local.y, local.x), radius > 0.0);
    let uv = vec2f(fract(angle / POLAR_TAU), sqrt((radius - inner) / (outer - inner)));
    let resolution = vec2f(lighting.polarSampling.xy);
    let cell = min(floor(uv * resolution), resolution - 1.0);
    let bias = polarCasterBias(pixel, size, world, basis, angle, radius, uv);
    let depth = clamp(0.5 + (local.z - bias) / POLAR_DEPTH_SPAN, 0.0, 1.0);
    return vec2u(u32(cell.y) * lighting.polarSampling.x + u32(cell.x), bitcast<u32>(depth));
}

@group(3) @binding(0) var<storage, read_write> polarDepths: array<atomic<u32>>;
@group(3) @binding(1) var polarOutput: texture_storage_2d<r32float, write>;

@compute @workgroup_size(8, 8)
fn polarClear(@builtin(global_invocation_id) id: vec3u) {
    let size = lighting.polarSampling.xy;
    if (all(id.xy < size)) {
        atomicStore(&polarDepths[id.y * size.x + id.x], 0u);
    }
}

@compute @workgroup_size(8, 8)
fn polarMerge(@builtin(global_invocation_id) id: vec3u) {
    let size = lighting.polarSampling.xy;
    if (any(id.xy >= size)) {
        return;
    }
    let index = id.y * size.x + id.x;
    let bits = atomicLoad(&polarDepths[index]);
    let mainDepth = bitcast<f32>(bits);
    var csmDepth = 0.0;
    if ((lighting.polarSampling.w & 2u) != 0u) {
        csmDepth = polarCsmDepth(vec2f(id.xy) + 0.5);
    }
    textureStore(polarOutput, vec2i(id.xy), vec4f(max(mainDepth, csmDepth), 0, 0, 0));
}
