struct CameraFrame {
    preExposure: f32,
    inversePreExposure: f32,
    previousPreExposure: f32,
    historyToCurrent: f32,
}

// 照明・散乱をシーンリニアで合成した後、HDRターゲットへ書く直前に適用する。
fn preExposeRadiance(radiance: vec3f, frame: CameraFrame) -> vec3f {
    return radiance * frame.preExposure;
}
