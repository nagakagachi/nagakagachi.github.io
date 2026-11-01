// 地球の球殻大気。距離はm、係数は1/m。RGBの簡略モデルで、オゾンと多重散乱は含めない。
const EARTH_RADIUS: f32 = 6371000.0;
const ATMOSPHERE_RADIUS: f32 = 6471000.0;
const RAYLEIGH: vec3f = vec3f(5.802e-6, 13.558e-6, 33.1e-6);
const MIE_SCATTER: f32 = 3.996e-6;
const MIE_EXTINCTION: f32 = 4.44e-6;
const SUN_IRRADIANCE: f32 = 20.0;
const VIEW_STEPS: u32 = 16u;
const SUN_STEPS: u32 = 8u;
struct AtmosphereSample {
    transmittance: vec3f,
    scattering: vec3f,
}
fn sphereInterval(origin: vec3f, ray: vec3f, radius: f32) -> vec2f {
    let b = dot(origin, ray);
    let r = length(origin);
    // r*r-radius*radiusの大きな値同士の差を避ける。
    let c = (r - radius) * (r + radius);
    let discriminant = b * b - c;
    if (discriminant < 0.0) { return vec2f(-1.0); }
    let distance = sqrt(discriminant);
    return vec2f(-b - distance, -b + distance);
}
fn atmosphereDensity(position: vec3f) -> vec2f {
    let height = max(length(position) - EARTH_RADIUS, 0.0);
    return exp(-height / vec2f(8000.0, 1200.0));
}
fn atmosphereExtinction(density: vec2f) -> vec3f {
    return RAYLEIGH * density.x + vec3f(MIE_EXTINCTION * density.y);
}
fn solarTransmittance(position: vec3f, sun: vec3f) -> vec3f {
    let ground = sphereInterval(position, sun, EARTH_RADIUS);
    if (ground.x > 0.0) { return vec3f(0.0); }
    let top = sphereInterval(position, sun, ATMOSPHERE_RADIUS);
    let start = max(top.x, 0.0);
    let end = max(top.y, start);
    var opticalDepth = vec2f(0.0);
    for (var i = 0u; i < SUN_STEPS; i++) {
        let a = f32(i) / f32(SUN_STEPS);
        let b = f32(i + 1u) / f32(SUN_STEPS);
        let t0 = mix(start, end, a * a);
        let t1 = mix(start, end, b * b);
        opticalDepth += atmosphereDensity(position + sun * (0.5 * (t0 + t1))) * (t1 - t0);
    }
    return exp(-atmosphereExtinction(opticalDepth));
}
fn integrateAtmosphere(origin: vec3f, ray: vec3f, sun: vec3f, maximumDistance: f32) -> AtmosphereSample {
    let top = sphereInterval(origin, ray, ATMOSPHERE_RADIUS);
    let start = max(top.x, 0.0);
    var end = min(top.y, maximumDistance);
    let ground = sphereInterval(origin, ray, EARTH_RADIUS);
    if (ground.x > 0.0) { end = min(end, ground.x); }
    if (end <= start) { return AtmosphereSample(vec3f(1.0), vec3f(0.0)); }
    let mu = clamp(dot(ray, sun), -1.0, 1.0);
    let rayleighPhase = 3.0 * (1.0 + mu * mu) / (16.0 * 3.14159265);
    let g = 0.8;
    let miePhase = (1.0 - g * g) / (12.56637061 * pow(1.0 + g * g - 2.0 * g * mu, 1.5));
    var transmittance = vec3f(1.0);
    var scattering = vec3f(0.0);
    for (var i = 0u; i < VIEW_STEPS; i++) {
        // 観測点付近の高密度層へ多めにサンプルを割り当てる。
        let a = f32(i) / f32(VIEW_STEPS);
        let b = f32(i + 1u) / f32(VIEW_STEPS);
        let t0 = mix(start, end, a * a);
        let t1 = mix(start, end, b * b);
        let point = origin + ray * (0.5 * (t0 + t1));
        let density = atmosphereDensity(point);
        let extinction = atmosphereExtinction(density);
        let segmentT = exp(-extinction * (t1 - t0));
        let source = SUN_IRRADIANCE * solarTransmittance(point, sun)
            * (RAYLEIGH * density.x * rayleighPhase + vec3f(MIE_SCATTER * density.y * miePhase));
        // 区間内の密度・光源項を一定としたBeer-Lambert積分。
        scattering += transmittance * source * (1.0 - segmentT) / max(extinction, vec3f(1e-9));
        transmittance *= segmentT;
    }
    return AtmosphereSample(transmittance, scattering);
}
