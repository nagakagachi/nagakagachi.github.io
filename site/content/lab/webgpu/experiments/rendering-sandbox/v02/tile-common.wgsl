// 共有Uniformは752バイト。各項目のバイト位置はmain.tsを参照。
struct Scene {
    viewProjection: mat4x4f,
    planes: array<vec4f, 6>,
    light: vec4f,
    elevation: vec4f, // 最低標高、標高幅の逆数、法線表示、タイル色分け。
    domain: vec4f, // 標高窓サイズ、標高段数、最細間隔、Height Clipmap色分け。
    terrain: vec4f, // 標高原点、最低/最高標高の保守的範囲、HeightMapグリッド。
    layoutInfo: vec4u, // 密度、LOD段数、候補数、カリング有効フラグ。
    cascades: array<vec4f, 8>, // 原点X/Z、セル間隔、段の半幅。
    heightWindows: array<vec4i, 7>, // 各標高窓の世界格子原点X/Z、予約、予約。
    casterPlanes: array<vec4f, 16>, // 受光フラスタムを光源方向へ押し出した凸体。
    casterInfo: vec4u, // 有効平面数、予約。
}
@group(0) @binding(0) var<uniform> scene: Scene;

struct Tile {
    coord: vec2i,
    level: u32,
    mask: u32,
}

// 候補IDからの配置復元はComputeの各laneで1回だけ行い、VSでは繰り返さない。
fn decodeTile(id: u32) -> Tile {
    let n = scene.layoutInfo.x;
    let full = n * n;
    let ring = full * 3u / 4u;
    var level = 0u;
    var k = id;
    if (id >= full) {
        level = 1u + (id - full) / ring;
        k = (id - full) % ring;
    }
    let top = full / 4u;
    let half = n / 2u;
    let quarter = n / 4u;
    var row = 0u;
    var col = 0u;
    if (level == 0u || k < top) {
        row = k / n;
        col = k % n;
    } else if (k < top * 2u) {
        let q = k - top;
        row = quarter + q / half;
        let j = q % half;
        col = select(j + half, j, j < quarter);
    } else {
        let q = k - top * 2u;
        row = quarter * 3u + q / n;
        col = q % n;
    }
    let p = vec2i(vec2u(col, row)) - vec2i(i32(half));
    var mask = 0u;
    // 補正が必要なのは細かい側の外周だけ。最も粗い段の外周は動かさない。
    if (level + 1u < scene.layoutInfo.y) {
        if (p.y == -i32(half)) { mask |= 1u; }
        if (p.x == i32(half) - 1) { mask |= 2u; }
        if (p.y == i32(half) - 1) { mask |= 4u; }
        if (p.x == -i32(half)) { mask |= 8u; }
    }
    return Tile(p, level, mask);
}

// ビット0〜10に元の候補IDを残し、デバッグ色を安定させる。
// ビット11〜14：X+8、15〜18：Z+8、19〜21：LOD段、22〜25：外周辺N/E/S/W。
fn packCandidate(id: u32) -> u32 {
    if (id >= scene.layoutInfo.z) { return 0u; }
    let t = decodeTile(id);
    return id | (u32(t.coord.x + 8) << 11u) | (u32(t.coord.y + 8) << 15u)
        | (t.level << 19u) | (t.mask << 22u);
}

fn unpackTile(value: u32) -> Tile {
    return Tile(
        vec2i(i32((value >> 11u) & 15u) - 8, i32((value >> 15u) & 15u) - 8),
        (value >> 19u) & 7u,
        (value >> 22u) & 15u
    );
}
