@group(0) @binding(1) var<storage, read> heightMap: array<u32>;
@group(0) @binding(2) var<storage, read> visible: array<u32>;

struct GridPosition {
    xz: vec2f,
    weight: f32,
}

// これらはVS内部だけの情報で、PSへ渡す補間属性は増やさない。
struct Surface {
    clip: vec4f,
    xz: vec2f,
    height: f32,
    tileID: u32,
    layer: u32,
    coarseLayer: u32,
    weight: f32,
}

fn heightTexel(cell: vec2i, layer: u32) -> f32 {
    let physical = vec2u(cell) & vec2u(1023u);
    let word = layer * 524288u + physical.y * 512u + physical.x / 2u;
    let pair = unpack2x16float(heightMap[word]);
    return select(pair.x, pair.y, (physical.x & 1u) != 0u);
}

fn sampleHeight(xz: vec2f, layer: u32) -> f32 {
    let pixel = xz / f32(1u << layer);
    let lower = vec2i(floor(pixel));
    let f = fract(pixel);
    // 世界格子を循環先へ写すだけで、窓原点を跨いでも地形の位相を変えない。
    // 必要領域が窓内へ収まることはCPU側の範囲・補間余裕テストで確認する。
    let a = heightTexel(lower, layer);
    let b = heightTexel(lower + vec2i(1, 0), layer);
    let c = heightTexel(lower + vec2i(0, 1), layer);
    let d = heightTexel(lower + vec2i(1, 1), layer);
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

fn blendedHeight(xz: vec2f, layer: u32, coarse: u32, weight: f32) -> f32 {
    let fineHeight = sampleHeight(xz, layer);
    if (weight > 0.0 && layer != coarse) {
        // 高周波除去で段ごとに標高が異なるため、XZだけでなく標高も粗い段へ一致させる。
        return mix(fineHeight, sampleHeight(xz, coarse), weight);
    }
    return fineHeight;
}

// 全タイルで通常格子を共有する。packed情報を使い、VSごとのリング判定を省く。
// 2セルスナップの原点差を外周8行で吸収し、粗格子の点へ位置と標高を一致させる。
fn worldXZ(id: u32, tile: Tile) -> GridPosition {
    let c = scene.cascades[tile.level];
    let grid = tile.coord * 64 + vec2i(i32(id % 65u), i32(id / 65u));
    var xz = c.xy + vec2f(grid) * c.z;
    var weight = 0.0;
    if (tile.mask != 0u) {
        let coarse = scene.cascades[tile.level + 1u];
        // 接続先の粗格子点を共有する頂点は同じ重みで動かす。
        // 元の頂点位置ごとに重みを変えると、2セル移動時に角の面が反転・非縮退化する。
        let coarseXZ = coarse.xy + vec2f((grid >> vec2u(1u)) * 2) * c.z;
        let distance = max(abs(coarseXZ.x - coarse.x), abs(coarseXZ.y - coarse.y));
        weight = clamp((distance - (c.w - 8.0 * c.z)) / (8.0 * c.z), 0.0, 1.0);
        xz = mix(xz, coarseXZ, weight);
    }
    return GridPosition(xz, weight);
}

// タイル描画とワイヤーフレームで位置補正と標高取得を共有する。ワイヤーフレーム用には法線を計算しない。
fn terrainVertex(id: u32, instance: u32) -> Surface {
    let descriptor = visible[instance];
    let tile = unpackTile(descriptor);
    let grid = worldXZ(id, tile);
    let last = u32(scene.domain.y) - 1u;
    let layer = min(u32(max(i32(tile.level) - 1, 0)), last);
    let coarse = min(tile.level, last);
    let h = blendedHeight(grid.xz, layer, coarse, grid.weight);
    let position = vec3f(grid.xz.x, h, grid.xz.y);
    return Surface(scene.viewProjection * vec4f(position, 1.0), grid.xz, h,
        descriptor & 2047u, layer, coarse, grid.weight);
}
