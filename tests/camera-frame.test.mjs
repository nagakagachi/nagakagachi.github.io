import test from 'node:test';
import assert from 'node:assert/strict';
import { cameraFrame } from '../site/content/lab/webgpu/experiments/rendering-sandbox/v01/camera-frame.ts';
import { skyRayFrame } from '../site/content/lab/webgpu/experiments/rendering-sandbox/v01/render-math.ts';

test('カメラのPreExposureと逆数・履歴の尺度変換が一致する', () => {
    for (const previous of [0.1, 1, 4]) {
        for (const current of [0.1, 0.5, 1, 4]) {
            const frame = cameraFrame(-Math.log2(current), 60, previous);
            const sceneRadiance = 10;
            assert.ok(Math.abs(sceneRadiance * previous * frame.historyToCurrent - sceneRadiance * current) < 1e-12);
            assert.ok(Math.abs(frame.preExposure * frame.inversePreExposure - 1) < 1e-12);
            assert.equal(frame.previousPreExposure, previous);
        }
    }
});

test('指定画角と天空ピクセルレイの端の角度が一致する', () => {
    for (const degrees of [30, 60, 90, 110]) {
        const frame = cameraFrame(0, degrees, 1);
        const rays = skyRayFrame(0, 0, 2, frame.verticalFov);
        assert.ok(Math.abs(2 * Math.atan(rays[9]) - frame.verticalFov) < 1e-7);
        assert.ok(Math.abs(rays[4] / rays[9] - 2) < 1e-7);
    }
});

test('非有限値や範囲外のカメラ条件を拒否する', () => {
    for (const ev100 of [-10.1, 15.1, NaN, Infinity]) { assert.throws(() => cameraFrame(ev100, 60, 1)); }
    for (const fov of [29, 111, NaN]) { assert.throws(() => cameraFrame(0, fov, 1)); }
    assert.throws(() => cameraFrame(0, 60, 0));
});

test('EV100の範囲端と1段ごとの半減がPreExposureへ正しく換算される', () => {
    for (const ev of [-10, -1, 0, 1, 14, 15]) {
        const frame = cameraFrame(ev, 60, 1);
        assert.equal(frame.preExposure, 2 ** -ev);
        assert.equal(frame.uniform[0], 2 ** -ev);
        assert.equal(frame.inversePreExposure, 2 ** ev);
        if (ev < 15) { assert.equal(cameraFrame(ev + 1, 60, 1).preExposure, frame.preExposure / 2); }
    }
});
