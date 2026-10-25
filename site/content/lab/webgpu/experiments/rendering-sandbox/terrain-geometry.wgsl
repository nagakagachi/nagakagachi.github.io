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
// 原点差が細かい側の1セル分あっても角が反転しないよう、外周4行で補正する。
fn worldXZ(id: u32, tile: Tile) -> GridPosition {
    let c = scene.cascades[tile.level];
    let grid = tile.coord * 64 + vec2i(i32(id % 65u), i32(id / 65u));
    var xz = c.xy + vec2f(grid) * c.z;
    var weight = 0.0;
    if (tile.mask != 0u) {
        let coarse = scene.cascades[tile.level + 1u];
        let half = f32(scene.layoutInfo.x * 32u);
        let weights = clamp((abs(vec2f(grid)) - (half - 4.0)) * 0.25, vec2f(0.0), vec2f(1.0));
        // 原点差は境界の法線方向へ、偶奇頂点の集約は接線方向へ反映する。
        // 負の格子座標でも、ビットANDで偶奇を0または1として求められる。
        let parity = vec2f(grid & vec2i(1));
        xz += max(weights.x, weights.y) * (coarse.xy - c.xy)
            - weights.yx * parity * c.z;
        // 集約前の頂点番号ではなく、補正後の同じ世界位置には同じ標高混合率を与える。
        // 四隅で異なる格子行の頂点が同一点へ集まっても、立体的な縮退を維持する。
        let distance = max(abs(xz.x - coarse.x), abs(xz.y - coarse.y));
        weight = clamp((distance - (c.w - 4.0 * c.z)) / (4.0 * c.z), 0.0, 1.0);
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
