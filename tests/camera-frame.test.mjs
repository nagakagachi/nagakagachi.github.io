import test from 'node:test';
import assert from 'node:assert/strict';
import { cameraFrame } from '../site/content/lab/webgpu/experiments/rendering-sandbox/v01/camera-frame.ts';
import { skyRayFrame } from '../site/content/lab/webgpu/experiments/rendering-sandbox/v01/render-math.ts';

test('カメラのPreExposureと逆数・履歴の尺度変換が一致する', () => {
    for (const previous of [0.1, 1, 4]) {
        for (const current of [0.1, 0.5, 1, 4]) {
            const frame = cameraFrame(current, 60, previous);
            const sceneRadiance = 10;
            assert.ok(Math.abs(sceneRadiance * previous * frame.historyToCurrent - sceneRadiance * current) < 1e-12);
            assert.ok(Math.abs(frame.preExposure * frame.inversePreExposure - 1) < 1e-12);
            assert.equal(frame.previousPreExposure, previous);
        }
    }
});

test('指定画角と天空ピクセルレイの端の角度が一致する', () => {
    for (const degrees of [30, 60, 90, 110]) {
        const frame = cameraFrame(1, degrees, 1);
        const rays = skyRayFrame(0, 0, 2, frame.verticalFov);
        assert.ok(Math.abs(2 * Math.atan(rays[9]) - frame.verticalFov) < 1e-7);
        assert.ok(Math.abs(rays[4] / rays[9] - 2) < 1e-7);
    }
});

test('非有限値や範囲外のカメラ条件を拒否する', () => {
    for (const exposure of [0, -1, NaN, Infinity]) { assert.throws(() => cameraFrame(exposure, 60, 1)); }
    for (const fov of [29, 111, NaN]) { assert.throws(() => cameraFrame(1, fov, 1)); }
    assert.throws(() => cameraFrame(1, 60, 0));
});
