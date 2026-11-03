// 地形と樹木で共通の極座標シャドウ比較。
@group(2) @binding(0) var polarGridMap: texture_2d<f32>;

const POLAR_TAU: f32 = 6.283185307;
const POLAR_DEPTH_SPAN: f32 = 32000.0;

fn polarCompareCell(cell: vec2i, size: vec2i, receiver: f32) -> f32 {
    let x = (cell.x + size.x) % size.x;
    let y = clamp(cell.y, 0, size.y - 1);
    let blocker = textureLoad(polarGridMap, vec2i(x, y), 0).r;
    return select(1.0, 0.0, blocker > receiver);
}

fn polarShadowVisibility(position: vec3f) -> f32 {
    if (lighting.polar.z == 0.0) {
        return 1.0;
    }
    let local = transpose(polarBasis()) * (position - lighting.cameraPosition.xyz);
    let radius = length(local.xy);
    let inner = lighting.cameraPosition.w;
    let outer = lighting.polar.x;
    if (radius < inner || radius >= outer || abs(local.z) > POLAR_DEPTH_SPAN * 0.5) {
        return 1.0;
    }
    let angle = select(0.0, atan2(local.y, local.x), radius > 0.0);
    let uv = vec2f(fract(angle / POLAR_TAU), sqrt((radius - inner) / (outer - inner)));
    let size = textureDimensions(polarGridMap);
    let cell = min(vec2i(uv * vec2f(size)), vec2i(size) - 1);
    // Reversed Zでは光源に近い遮蔽物ほど値が大きい。
    let receiver = 0.5 + local.z / POLAR_DEPTH_SPAN;
    if (lighting.polarSampling.z != 0u) {
        let texel = uv * vec2f(size) - 0.5;
        let base = vec2i(floor(texel));
        let weight = fract(texel);
        let dimensions = vec2i(size);
        let top = mix(polarCompareCell(base, dimensions, receiver),
                      polarCompareCell(base + vec2i(1, 0), dimensions, receiver), weight.x);
        let bottom = mix(polarCompareCell(base + vec2i(0, 1), dimensions, receiver),
                         polarCompareCell(base + vec2i(1, 1), dimensions, receiver), weight.x);
        return mix(top, bottom, weight.y);
    }
    let blocker = textureLoad(polarGridMap, cell, 0).r;
    return select(1.0, 0.0, blocker > receiver);
}

fn polarBasis() -> mat3x3f {
    let n = normalize(lighting.light.xyz);
    let axis = select(vec3f(0, 1, 0), vec3f(0, 0, 1), abs(n.y) > 0.99);
    let u = normalize(cross(axis, n));
    let v = cross(n, u);
    return mat3x3f(u, v, n);
}


fn polarSurfaceGrid(position: vec3f) -> vec3f {
    let local = transpose(polarBasis()) * (position - lighting.cameraPosition.xyz);
    let radius = length(local.xy);
    let inner = lighting.cameraPosition.w;
    let outer = lighting.polar.x;
    let uv = vec2f(
        select(0.0, atan2(local.y, local.x) / POLAR_TAU, radius > 0.0),
        sqrt(clamp((radius - inner) / (outer - inner), 0.0, 1.0)),
    );
    let scale = vec2f(lighting.polarSampling.xy) / 16.0;
    let cell = uv * scale;
    var dx = dpdx(uv);
    var dy = dpdy(uv);
    // 角度の継ぎ目では差分を一周分折り返す。
    dx.x -= round(dx.x);
    dy.x -= round(dy.x);
    let footprint = max((abs(dx) + abs(dy)) * scale, vec2f(0.0001));
    let edge = abs(fract(cell + 0.5) - 0.5);
    let lines = (1.0 - smoothstep(vec2f(0.3), vec2f(1.3), edge / footprint))
        * clamp(1.0 - footprint * 2.0, vec2f(0), vec2f(1));
    let covered = radius >= inner && radius < outer && abs(local.z) <= POLAR_DEPTH_SPAN * 0.5;
    return select(vec3f(0.15), mix(vec3f(0.65), vec3f(0.015), max(lines.x, lines.y)), covered);
}
