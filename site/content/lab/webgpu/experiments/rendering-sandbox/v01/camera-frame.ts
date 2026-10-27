export interface CameraFrame {
    readonly preExposure: number;
    readonly inversePreExposure: number;
    readonly previousPreExposure: number;
    readonly historyToCurrent: number;
    readonly verticalFov: number;
    readonly uniform: Float32Array<ArrayBuffer>;
}

// 手動露出はこのフレームのPreExposureとして使う。描画中は同じスナップショットを共有する。
export function cameraFrame(exposure: number, verticalFovDegrees: number, previousPreExposure: number): CameraFrame {
    if (!Number.isFinite(exposure) || exposure <= 0 || !Number.isFinite(previousPreExposure) || previousPreExposure <= 0
        || !Number.isFinite(verticalFovDegrees) || verticalFovDegrees < 30 || verticalFovDegrees > 110) {
        throw new Error('カメラの露出・画角が不正です');
    }
    return { preExposure: exposure, inversePreExposure: 1 / exposure, previousPreExposure,
        historyToCurrent: exposure / previousPreExposure, verticalFov: verticalFovDegrees * Math.PI / 180,
        uniform: new Float32Array([exposure, 1 / exposure, previousPreExposure, exposure / previousPreExposure]) };
}
