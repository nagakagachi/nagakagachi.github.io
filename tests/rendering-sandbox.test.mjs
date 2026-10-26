import test from 'node:test';
import assert from 'node:assert/strict';

function project(m, p) {
    return [0, 1, 2, 3].map(row => m[row] * p[0] + m[4 + row] * p[1] + m[8 + row] * p[2] + m[12 + row]);
}
function inside(planes, p) {
    return Array.from({ length: 6 }, (_, i) => planes[i * 4] * p[0] + planes[i * 4 + 1] * p[1]
        + planes[i * 4 + 2] * p[2] + planes[i * 4 + 3]).every(v => v >= -1e-6);
}
for (const version of ['v00', 'v01']) {
    const { encodeOpaquePasses } = await import(`../site/content/lab/webgpu/experiments/rendering-sandbox/${version}/render-passes.ts`);
    const { lightDirection, shadowMatrix, frustumPlanes, skyRayFrame } = await import(`../site/content/lab/webgpu/experiments/rendering-sandbox/${version}/render-math.ts`);
    test(`${version}: ライト方向は単位長で、仰角と方位角の定義が一致する`, () => {
        for (const az of [0, 60, 90, 180, 270, 360]) {
            for (const el of [5, 30, 85]) {
                const l = lightDirection(az, el);
                assert.ok(Math.abs(Math.hypot(...l) - 1) < 1e-12);
                assert.ok(Math.abs(l[1] - Math.sin(el * Math.PI / 180)) < 1e-12);
            }
        }
        assert.ok(lightDirection(90, 30)[0] > 0.8);
    });
    test(`${version}: シャドウ行列は0〜1のReversed Zで光源側の点が近い`, () => {
        const light = lightDirection(60, 30), center = [123, -70, -456];
        const m = shadowMatrix(center, light, 1024, 2000, 2048);
        const near = center.map((v, i) => v + light[i] * 2000);
        const far = center.map((v, i) => v - light[i] * 2000);
        assert.ok(Math.abs(project(m, near)[2] - 1) < 1e-6);
        assert.ok(Math.abs(project(m, far)[2]) < 1e-6);
        assert.equal(project(m, center)[3], 1);
    });
    test(`${version}: 光源の投影平面はサブテクセルの移動で変わらない`, () => {
        const l = lightDirection(0, 30);
        const a = shadowMatrix([0.1, 0, 0], l, 1024, 2000, 2048);
        const b = shadowMatrix([0.9, 0, 0], l, 1024, 2000, 2048);
        assert.deepEqual(a, b);
        const c = shadowMatrix([1.1, 0, 0], l, 1024, 2000, 2048);
        assert.notEqual(a[12], c[12]);
    });
    test(`${version}: フラスタム6平面は光源のXY/Z各境界を判定する`, () => {
        const light = lightDirection(0, 30), m = shadowMatrix([0, 0, 0], light, 100, 500, 2048);
        const planes = frustumPlanes(m);
        assert.ok(inside(planes, [0, 0, 0]));
        assert.ok(!inside(planes, [101, 0, 0]));
        assert.ok(!inside(planes, [-101, 0, 0]));
        assert.ok(!inside(planes, light.map(v => v * 501)));
        assert.ok(!inside(planes, light.map(v => -v * 501)));
    });

    test(`${version}: ZPrePassで深度を確定してからShadowPass、Forwardへ進む`, () => {
        const descriptors = [], events = [];
        const encoder = { beginRenderPass(desc) {
            descriptors.push(desc);
            return { end() { events.push(desc.label + ':end'); } };
        } };
        const object = { drawDepth(pass, view) { events.push('depth:' + view); },
            drawForward() { events.push('forward'); }, drawDebug() { events.push('debug'); } };
        encodeOpaquePasses(encoder, {}, {}, {}, [object], true, false);
        assert.deepEqual(descriptors.map(d => d.label), ['ZPrePass', 'ShadowPass', 'ForwardShadingPass']);
        assert.deepEqual(events, ['depth:main', 'ZPrePass:end', 'depth:shadow', 'ShadowPass:end', 'forward', 'ForwardShadingPass:end']);
        assert.equal(descriptors[2].depthStencilAttachment.depthReadOnly, true);
        assert.equal(descriptors[0].depthStencilAttachment.depthStoreOp, 'store');
    });

    test(`${version}: 背景ピクセルレイの基底はカメラの方向とFOVに一致する`, () => {
        const frame = skyRayFrame(0, 0, 2);
        assert.deepEqual([...frame.slice(0, 3)].map(v => v === 0 ? 0 : v), [0, 0, -1]);
        assert.ok(Math.abs(frame[4] - 2 * Math.tan(Math.PI / 6)) < 1e-6);
        assert.ok(Math.abs(frame[9] - Math.tan(Math.PI / 6)) < 1e-6);
        for (const [yaw, pitch] of [[0.55, 0], [1.2, -1], [-2, 1.5]]) {
            const v = skyRayFrame(yaw, pitch, 16 / 9);
            const forward = [...v.slice(0, 3)], right = [...v.slice(4, 7)], up = [...v.slice(8, 11)];
            const dot = (a, b) => a.reduce((sum, x, i) => sum + x * b[i], 0);
            assert.ok(Math.abs(dot(forward, right)) < 1e-6);
            assert.ok(Math.abs(dot(forward, up)) < 1e-6);
            assert.ok(Math.abs(dot(up, right)) < 1e-6);
        }
    });
}
