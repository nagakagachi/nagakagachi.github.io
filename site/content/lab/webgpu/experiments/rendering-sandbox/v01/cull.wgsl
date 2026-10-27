@group(0) @binding(1) var<storage, read_write> visible: array<u32>;

// drawIndexedIndirectの20バイト引数に一致させる。可視数だけをAtomic変数とする。
struct DrawArgs {
    indexCount: u32,
    instanceCount: atomic<u32>,
    firstIndex: u32,
    baseVertex: i32,
    firstInstance: u32,
}
@group(0) @binding(2) var<storage, read_write> arguments: DrawArgs;

// laneの可視判定関数は早期returnできるが、呼出元の集約処理からは早期returnしない。
fn tileVisible(id: u32, descriptor: u32) -> bool {
    if (id >= scene.layoutInfo.z) { return false; }
    let tile = unpackTile(descriptor);
    let c = scene.cascades[tile.level];
    // 細かい側の境界補正による移動を含むよう、3セル分の保守的な余裕を取る。
    let lo = c.xy + vec2f(tile.coord) * 64.0 * c.z - vec2f(3.0 * c.z);
    let hi = c.xy + vec2f(tile.coord + vec2i(1)) * 64.0 * c.z + vec2f(3.0 * c.z);
    let center = vec3f((lo.x + hi.x) * 0.5, (scene.terrain.y + scene.terrain.z) * 0.5, (lo.y + hi.y) * 0.5);
    let extent = vec3f((hi.x - lo.x) * 0.5, (scene.terrain.z - scene.terrain.y) * 0.5, (hi.y - lo.y) * 0.5);
    if (scene.layoutInfo.w != 0u) {
        for (var p = 0u; p < 6u; p++) {
            let plane = scene.planes[p];
            if (dot(plane.xyz, center) + plane.w + dot(abs(plane.xyz), extent) < 0.0) {
                return false;
            }
        }
    }
    return true;
}
