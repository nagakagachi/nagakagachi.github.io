import test from 'node:test';
import assert from 'node:assert/strict';
import { heightOrigin, updateRects, heightLevels, HEIGHT_LEVEL_BYTES, HEIGHT_SIZE } from '../site/content/lab/webgpu/experiments/terrain-rendering00/height-clipmap.ts';
import { createLayout, cascadeParameters } from '../site/content/lab/webgpu/experiments/terrain-rendering00/clipmap-grid.ts';
test('FP16の固定容量は2 MiB/段、16km設定は7段', () => {
    assert.equal(HEIGHT_LEVEL_BYTES, 2097152);
    assert.equal(heightLevels(createLayout(4, 16000).levels), 7);
});
// 小さい循環面で全セルを列挙し、更新矩形の重複と、保持できるセルの不要更新を検出する。
for (const size of [8, 16]) {
    test(`差分矩形は新規領域だけを重複なく覆う size=${size}`, () => {
        const previous = { x: -4, z: -3 };
        for (let dx = -size - 2; dx <= size + 2; dx += 2) {
            for (let dz = -size - 1; dz <= size + 1; dz++) {
                const next = { x: previous.x + dx, z: previous.z + dz };
                const rects = updateRects(previous, next, size), seen = new Set();
                for (const r of rects) {
                    assert.equal(r.x & 1, 0);
                    assert.equal(r.width & 1, 0);
                    for (let z = r.z; z < r.z + r.height; z++) {
                        for (let x = r.x; x < r.x + r.width; x++) {
                            const key = `${x},${z}`;
                            assert.ok(!seen.has(key), key);
                            seen.add(key);
                            assert.ok(x >= next.x && x < next.x + size && z >= next.z && z < next.z + size);
                        }
                    }
                }
                for (let z = next.z; z < next.z + size; z++) {
                    for (let x = next.x; x < next.x + size; x++) {
                        const retained = x >= previous.x && x < previous.x + size && z >= previous.z && z < previous.z + size;
                        assert.equal(seen.has(`${x},${z}`), !retained);
                    }
                }
            }
        }
    });
}
test('負座標でも原点Xは偶数で、静止中は更新ゼロ', () => {
    for (let l = 0; l < 7; l++) {
        for (const x of [-10000, -2.5, -0.1, 0, 1.9, 2, 123456]) {
            const o = heightOrigin(x, -x, l);
            assert.equal(o.x & 1, 0);
            assert.deepEqual(updateRects(o, o), []);
            assert.equal(updateRects(undefined, o)[0].width, HEIGHT_SIZE);
        }
    }
});
test('全密度・全段で標高窓にメッシュと補間・法線の余裕がある', () => {
    for (const density of [4, 8, 16]) {
        for (const radius of [250, 500, 1000, 2000, 4000, 8000, 16000]) {
            const layout = createLayout(density, radius), count = heightLevels(layout.levels);
            for (const x of [-65537.25, -129.75, -0.25, 0, 1.75, 127.9, 65537.75]) {
                const z = -x * 0.7, origins = cascadeParameters(x, z, layout, true);
                for (let l = 0; l < layout.levels; l++) {
                    for (const h of [Math.max(0, l - 1), Math.min(l, count - 1)]) {
                        const o = heightOrigin(x, z, h), s = 2 ** h;
                        const r = 128 * 2 ** l + 2 * layout.steps[l] + 2 * s;
                        assert.ok((origins[l * 4] - r) / s >= o.x && (origins[l * 4] + r) / s + 1 < o.x + 1024);
                        assert.ok((origins[l * 4 + 1] - r) / s >= o.z && (origins[l * 4 + 1] + r) / s + 1 < o.z + 1024);
                    }
                }
            }
        }
    }
});
