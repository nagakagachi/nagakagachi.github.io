struct SkyParameters {
    sun: vec4f,
    observer: vec4f, // 海面基準高度m、予約。
}
@group(0) @binding(0) var<uniform> sky: SkyParameters;

// ピクセルレイ背景とOctahedral生成で同じ地球大気を評価する。
fn skyRadiance(direction: vec3f) -> vec3f {
    let origin = vec3f(0.0, EARTH_RADIUS + max(sky.observer.x, 2.0), 0.0);
    let sample = integrateAtmosphere(origin, direction, sky.sun.xyz, 1e9);
    var groundRadiance = vec3f(0.0);
    let ground = sphereInterval(origin, direction, EARTH_RADIUS);
    if (ground.x > 0.0) {
        let point = origin + direction * ground.x;
        let normal = normalize(point);
        groundRadiance = vec3f(0.08) * SUN_IRRADIANCE * solarTransmittance(point + normal * 2.0, sky.sun.xyz)
            * max(dot(normal, sky.sun.xyz), 0.0) / 3.14159265;
    }
    // 鋭い太陽円盤は含めない。直射光はDirectional Lightへ分離する。
    return sample.scattering + sample.transmittance * groundRadiance;
}
