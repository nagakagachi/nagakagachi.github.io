import { readFileSync } from 'node:fs';
import { heightLevels } from '../site/content/lab/webgpu/experiments/rendering-sandbox/v01/height-clipmap.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createTileIndices, createLayout, decodeTile, tileVertex, cascadeParameters, MAX_CANDIDATES, packTile, unpackTile } from '../site/content/lab/webgpu/experiments/rendering-sandbox/v01/clipmap-grid.ts';
const grid = createTileIndices();
test('shared tile fits uint16 without a vertex buffer', () => {
    assert.equal(grid.vertexCount, 4225);
    assert.equal(grid.surface.length, 24576);
    assert.ok(Math.max(...grid.surface) < 65536);
    assert.equal(grid.surface.byteLength, 49152);
});
for (const density of [4, 8, 16]) {
    test(`layout ${density}: unique slots, complete rings and coverage`, () => {
        const layout = createLayout(density, 16000), slots = new Set();
        assert.equal(layout.levels, 8);
        assert.ok(layout.count <= MAX_CANDIDATES);
        assert.ok(layout.guaranteed >= 16000);
        for (let id = 0; id < layout.count; id++) {
            const t = decodeTile(id, density), key = `${t.level}/${t.x}/${t.z}`;
            assert.ok(!slots.has(key));
            slots.add(key);
            assert.ok(t.x >= -density / 2 && t.x < density / 2 && t.z >= -density / 2 && t.z < density / 2);
            if (t.level > 0) {
                assert.ok(Math.max(Math.abs(t.x + 0.5), Math.abs(t.z + 0.5)) > density / 4);
            }
        }
        assert.equal(slots.size, layout.count);
        for (const r of [1, 127, 128, 250, 500, 1000, 2000, 4000, 8000, 16000]) {
            const l = createLayout(density, r);
            assert.ok(l.guaranteed >= r);
            if (l.levels > 1) {
                assert.ok(l.guaranteed / 2 < r);
            }
        }
    });
}
// 生成した三角形をXZ平面上で比較する。解像度境界や独立したスナップ位相の角でも、
// 内部の各辺が必ず2枚の面に共有されることを確認する。
for (const [x, z, snap, requested] of [...Array.from({ length: 16 }, (_, i) => [(i % 4) * 2 + 0.25, Math.floor(i / 4) * 2 + 0.25, true, 500]), [-0.25, -0.75, true, 500], [7.25, -4.5, true, 500], [0.3, -0.8, false, 500]]) {
    test(`watertight stitched surface x=${x}, z=${z}, snap=${snap}`, () => {
        const layout = createLayout(4, requested), origins = cascadeParameters(x, z, layout, snap), edges = new Map();
        let area = 0, triangles = 0;
        const key = p => `${p.x.toFixed(5)},${p.z.toFixed(5)},${p.h.toFixed(5)}`;
        for (let id = 0; id < layout.count; id++) {
            const tile = decodeTile(id, 4);
            const layer = Math.max(0, tile.level - 1);
            const coarse = Math.min(tile.level, heightLevels(layout.levels) - 1);
            // 段ごとに異なる仮想標高を与え、XZだけでなく標高を含む接続を検証する。
            const sample = (p, l) => Math.sin(p.x / 17 + l) * 11 + Math.cos(p.z / 23 - l) * 9;
            const vertices = Array.from({ length: grid.vertexCount }, (_, v) => {
                const p = tileVertex(v, tile, layout, origins);
                return { ...p, h: sample(p, layer) * (1 - p.weight) + sample(p, coarse) * p.weight };
            });
            for (let i = 0; i < grid.surface.length; i += 3) {
                const v = [vertices[grid.surface[i]], vertices[grid.surface[i + 1]], vertices[grid.surface[i + 2]]];
                const signed = (v[1].x - v[0].x) * (v[2].z - v[0].z) - (v[1].z - v[0].z) * (v[2].x - v[0].x);
                if (Math.abs(signed) < 1e-8) {
                    assert.ok(new Set(v.map(key)).size < 3, `collinear non-duplicate vertices: tile ${id}, index ${i}`);
                    continue;
                }
                assert.ok(signed < 0, `inverted triangle: tile ${id}, index ${i}`);
                area -= signed / 2;
                triangles++;
                for (let j = 0; j < 3; j++) {
                    const a = key(v[j]), b = key(v[(j + 1) % 3]), k = [a, b].sort().join('/');
                    edges.set(k, (edges.get(k) || 0) + 1);
                }
            }
        }
        const l = layout.levels - 1, ox = origins[l * 4], oz = origins[l * 4 + 1], r = layout.radius;
        for (const [edge, count] of edges) {
            assert.ok(count <= 2, `overlap ${edge}: ${count}`);
            if (count === 1) {
                const [a, b] = edge.split('/').map(p => p.split(',').map(Number));
                assert.ok((Math.abs(Math.abs(a[0] - ox) - r) < 1e-4 && a[0] === b[0]) || (Math.abs(Math.abs(a[1] - oz) - r) < 1e-4 && a[1] === b[1]), `internal crack: ${edge}`);
            }
        }
        assert.ok(triangles > 0);
        assert.ok(Math.abs(area - 4 * r * r) < 1e-4, `${area} vs ${4 * r * r}`);
    });
}
for (const density of [4, 8, 16]) {
    test(`packed descriptors round-trip and boundary topology density ${density}`, () => {
        const layout = createLayout(density, 16000);
        for (let id = 0; id < layout.count; id++) {
            const tile = decodeTile(id, density, layout.levels), packed = packTile(id, tile);
            assert.equal(packed & 2047, id);
            assert.deepEqual(unpackTile(packed), tile);
            assert.equal(packed >>> 26, 0);
        }
        for (const dx of [0, 2 * layout.steps[0]]) {
            for (const dz of [0, 2 * layout.steps[0]]) {
                const origins = cascadeParameters(dx + 0.25, dz + 0.25, layout, true);
                for (const x of [-density / 2, density / 2 - 1]) {
                    for (const z of [-density / 2, density / 2 - 1]) {
                        const tile = { x, z, level: 0, mask: 15 };
                        const vertices = Array.from({ length: grid.vertexCount }, (_, v) => tileVertex(v, tile, layout, origins));
                        for (let i = 0; i < grid.surface.length; i += 3) {
                            const [a, b, c] = [vertices[grid.surface[i]], vertices[grid.surface[i + 1]], vertices[grid.surface[i + 2]]];
                            const signed = (b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x);
                            assert.ok(signed <= 0, `inverted ${density}/${dx}/${dz}/${x}/${z}/${i}`);
                            if (signed === 0) {
                                assert.ok(new Set([a, b, c].map(p => `${p.x},${p.z}`)).size < 3);
                            }
                        }
                    }
                }
            }
        }
    });
}

test('opaque terrain pixel shaders contain no discard, clip or depth output', () => {
    const source = readFileSync(new URL('../site/content/lab/webgpu/experiments/rendering-sandbox/v01/terrain-forward.wgsl', import.meta.url), 'utf8');
    const pixel = source.slice(source.indexOf('@fragment')).replace(/\/\/.*$/gm, '');
    assert.doesNotMatch(pixel, /\bdiscard\b|\bclip\s*\(|\bfrag_depth\b|\batomicAdd\b/);
});

// 通常部の同じ世界セルが、原点移動で別の対角線へ切り替わらないことを調べる。
test('全LOD・全密度で移動後も世界セルの三角形分割が不変', () => {
    for (const density of [4, 8, 16]) {
        const layout = createLayout(density, 16000);
        for (let level = 0; level < layout.levels; level++) {
            const step = layout.steps[level], x = 96 * 2 ** level, z = 12 * 2 ** level;
            const snapshots = [];
            for (const camera of [-7.25, -2.25, -0.25, 0.25, 1.25, 2.25, 6.25]) {
                const origins = cascadeParameters(camera, -camera, layout, true);
                assert.equal((origins[level * 4] / step) % 2 === 0, true);
                const cellX = Math.floor(x / step) * step, cellZ = Math.floor(z / step) * step;
                const tileX = Math.floor((cellX - origins[level * 4]) / (64 * step));
                const tileZ = Math.floor((cellZ - origins[level * 4 + 1]) / (64 * step));
                const tile = {x:tileX,z:tileZ,level,mask:0};
                const triangles = [];
                for (let i = 0; i < grid.surface.length; i += 3) {
                    const points = [...grid.surface.slice(i,i+3)].map(id => tileVertex(id,tile,layout,origins));
                    if (points.every(p => p.x >= cellX && p.x <= cellX+step && p.z >= cellZ && p.z <= cellZ+step)) {
                        triangles.push(points.map(p=>`${p.x},${p.z}`).sort().join('/'));
                    }
                }
                assert.equal(triangles.length,2);
                snapshots.push(triangles.sort());
            }
            snapshots.forEach(value=>assert.deepEqual(value,snapshots[0]));
        }
    }
});
