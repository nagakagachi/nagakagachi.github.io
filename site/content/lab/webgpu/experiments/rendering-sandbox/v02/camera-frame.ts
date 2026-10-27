export interface CameraFrame {
    readonly preExposure: number;
    readonly inversePreExposure: number;
    readonly previousPreExposure: number;
    readonly historyToCurrent: number;
    readonly verticalFov: number;
    readonly uniform: Float32Array<ArrayBuffer>;
}

// EV100は1増えると光量が半分になる。露出補正EVとは符号が逆。
// レンズ透過率による校正係数は1とし、EV100=0でPreExposure=1とする。
// 参考: https://dev.epicgames.com/documentation/en-us/unreal-engine/auto-exposure-in-unreal-engine
// 描画中は換算済みのPreExposureを同じスナップショットとして共有する。
export function cameraFrame(ev100: number, verticalFovDegrees: number, previousPreExposure: number): CameraFrame {
    if (!Number.isFinite(ev100) || ev100 < -10 || ev100 > 15 || !Number.isFinite(previousPreExposure) || previousPreExposure <= 0
        || !Number.isFinite(verticalFovDegrees) || verticalFovDegrees < 30 || verticalFovDegrees > 110) {
        throw new Error('カメラの露出・画角が不正です');
    }
    const exposure = 2 ** -ev100;
    return { preExposure: exposure, inversePreExposure: 1 / exposure, previousPreExposure,
        historyToCurrent: exposure / previousPreExposure, verticalFov: verticalFovDegrees * Math.PI / 180,
        uniform: new Float32Array([exposure, 1 / exposure, previousPreExposure, exposure / previousPreExposure]) };
}
