export const TILE_CELLS = 64;
export const CORE_VERTICES = 65 * 65;
export const MAX_CASCADES = 8;
export const MAX_CANDIDATES = 16 * 16 + 7 * 16 * 16 * 3 / 4;
export interface Layout {
    density: number;
    levels: number;
    count: number;
    radius: number;
    guaranteed: number;
    steps: number[];
}
export function createLayout(density: number, requested: number): Layout {
    if (![4, 8, 16].includes(density) || !Number.isFinite(requested) || requested < 1 || requested > 16000) {
        throw new Error('密度またはカバー半径が範囲外です');
    }
    let levels = 1;
    while (levels < MAX_CASCADES && (128 - 8 / density) * 2 ** (levels - 1) < requested) {
        levels++;
    }
    const radius = 128 * 2 ** (levels - 1), steps = Array.from({ length: levels }, (_, l) => 4 / density * 2 ** l);
    return { density, levels, count: density * density + (levels - 1) * density * density * 3 / 4, radius, guaranteed: radius - 2 * steps[levels - 1], steps };
}
export function cascadeParameters(x: number, z: number, layout: Layout, snap: boolean): Float32Array<ArrayBuffer> {
    const out = new Float32Array(MAX_CASCADES * 4);
    for (let l = 0; l < layout.levels; l++) {
        const s = layout.steps[l];
        // 交互の対角線を持つIBの周期は2セル。1セル移動では世界上の対角線が反転する。
        // 2セル単位で移動し、世界セルの三角形分割を維持する。
        // 親子の原点差は最大2細セル。接続帯では粗格子の点へ共通の重みで吸収する。
        const period = 2 * s;
        out.set([snap ? Math.floor(x / period) * period : x, snap ? Math.floor(z / period) * period : z, s, 128 * 2 ** l], l * 4);
    }
    return out;
}
export interface Tile {
    x: number;
    z: number;
    level: number;
    mask: number;
}
// トポロジーテスト用のCPU参照実装。WGSLのdecodeTileと同じ整数配置を使う。
export function decodeTile(id: number, density: number, levels = MAX_CASCADES): Tile {
    const full = density * density, ring = full * 3 / 4;
    let level = 0, k = id;
    if (id >= full) {
        level = 1 + Math.floor((id - full) / ring);
        k = (id - full) % ring;
    }
    let row: number, col: number;
    const top = full / 4, mid = full / 4, half = density / 2, quarter = density / 4;
    if (level === 0 || k < top) {
        row = Math.floor(k / density);
        col = k % density;
    }
    else if (k < top + mid) {
        const q = k - top;
        row = quarter + Math.floor(q / half);
        const j = q % half;
        col = j < quarter ? j : j + half;
    }
    else {
        const q = k - top - mid;
        row = 3 * quarter + Math.floor(q / density);
        col = q % density;
    }
    const x = col - half, z = row - half;
    let mask = 0;
    if (level + 1 < levels) {
        if (z === -half) {
            mask |= 1;
        }
        if (x === half - 1) {
            mask |= 2;
        }
        if (z === half - 1) {
            mask |= 4;
        }
        if (x === -half) {
            mask |= 8;
        }
    }
    return { x, z, level, mask };
}
export function createTileIndices(): {
    surface: Uint16Array<ArrayBuffer>;
    wire: Uint16Array<ArrayBuffer>;
    vertexCount: number;
} {
    const values: number[] = [];
    // 8×8セルのブロック順で頂点参照の局所性を保つ。対角線を交互にして、
    // 外周の奇数頂点を集約した後も2:1接続を保つ。一律の対角線では一部の角が反転する。
    for (let bz = 0; bz < 64; bz += 8) {
        for (let bx = 0; bx < 64; bx += 8) {
            for (let z = bz; z < bz + 8; z++) {
                for (let x = bx; x < bx + 8; x++) {
                    const a = z * 65 + x, b = a + 1, c = a + 65, d = c + 1;
                    if ((x + z) % 2 === 0) {
                        values.push(a, c, d, a, d, b);
                    }
                    else {
                        values.push(a, c, b, b, c, d);
                    }
                }
            }
        }
    }
    const edges = new Set<string>(), lines: number[] = [];
    for (let i = 0; i < values.length; i += 3) {
        for (let j = 0; j < 3; j++) {
            const a = values[i + j], b = values[i + (j + 1) % 3], key = a < b ? `${a},${b}` : `${b},${a}`;
            if (!edges.has(key)) {
                edges.add(key);
                lines.push(a, b);
            }
        }
    }
    return { surface: new Uint16Array(values), wire: new Uint16Array(lines), vertexCount: CORE_VERTICES };
}
// 共通VSのCPU参照実装。すべての頂点を通常タイルの格子内に保持する。
// 2セルスナップによる原点差を外周8行で吸収する。
// 同じ接続先へ集まる頂点は共通の重みを使い、立体的な縮退を維持する。
export function tileVertex(id: number, tile: Tile, layout: Layout, origins: Float32Array): {
    x: number;
    z: number;
    weight: number;
} {
    const l = tile.level, s = origins[l * 4 + 2], ox = origins[l * 4], oz = origins[l * 4 + 1];
    const u = tile.x * 64 + id % 65, v = tile.z * 64 + Math.floor(id / 65);
    let x = ox + u * s, z = oz + v * s;
    let weight = 0;
    if (l + 1 < layout.levels) {
        const cx = origins[(l + 1) * 4], cz = origins[(l + 1) * 4 + 1];
        const tx = cx + 2 * Math.floor(u / 2) * s;
        const tz = cz + 2 * Math.floor(v / 2) * s;
        const distance = Math.max(Math.abs(tx - cx), Math.abs(tz - cz));
        weight = Math.max(0, Math.min(1, (distance - (origins[l * 4 + 3] - 8 * s)) / (8 * s)));
        x += weight * (tx - x);
        z += weight * (tz - z);
    }
    return { x, z, weight };
}
// 可視タイルのビット配置：[0:10] 候補ID、[11:14] X+8、[15:18] Z+8、
// [19:21] LOD段、[22:25] 外周辺N/E/S/W。上位6ビットは予約する。
export function packTile(id: number, tile: Tile): number {
    return (id & 2047) | ((tile.x + 8) << 11) | ((tile.z + 8) << 15) | (tile.level << 19) | (tile.mask << 22);
}
export function unpackTile(value: number): Tile {
    return { x: ((value >>> 11) & 15) - 8, z: ((value >>> 15) & 15) - 8, level: (value >>> 19) & 7, mask: (value >>> 22) & 15 };
}
