struct Parameters {
    viewProjection: mat4x4f,
    camera: vec4f,
    lightDirection: vec4f,
    material: vec4f, // roughness, metallic, use texture, display mode
    baseColorAndLight: vec4f, // constant linear base color, light intensity
};
@group(0) @binding(0) var<uniform> parameters: Parameters;
@group(1) @binding(0) var albedoTexture: texture_2d<f32>;
@group(1) @binding(1) var albedoSampler: sampler;
const PI = 3.141592653589793;
struct VertexOutput {
    @builtin(position) position: vec4f,
    @location(0) worldPosition: vec3f,
    @location(1) normal: vec3f,
    @location(2) uv: vec2f,
};
@vertex fn vertexMain(@location(0) position: vec3f, @location(1) normal: vec3f, @location(2) uv: vec2f) -> VertexOutput {
    var output: VertexOutput;
    output.position = parameters.viewProjection * vec4f(position, 1.0);
    output.worldPosition = position; // Identity model transform.
    output.normal = normal;
    output.uv = uv;
    return output;
}
fn distributionGGX(noH: f32, alpha: f32) -> f32 {
    let alpha2 = alpha * alpha;
    let denominator = noH * noH * (alpha2 - 1.0) + 1.0;
    return alpha2 / (PI * denominator * denominator);
}
fn smithG1(noX: f32, alpha: f32) -> f32 {
    let alpha2 = alpha * alpha;
    return (2.0 * noX) / (noX + sqrt(alpha2 + (1.0 - alpha2) * noX * noX));
}
fn fresnelSchlick(voH: f32, f0: vec3f) -> vec3f {
    return f0 + (vec3f(1.0) - f0) * pow(1.0 - voH, 5.0);
}
fn linearToSRGB(color: vec3f) -> vec3f {
    let low = color * 12.92;
    let high = 1.055 * pow(max(color, vec3f(0.0)), vec3f(1.0 / 2.4)) - 0.055;
    return select(high, low, color <= vec3f(0.0031308));
}
@fragment fn fragmentMain(input: VertexOutput) -> @location(0) vec4f {
    // Sample before directional branches; textureSample uses implicit derivatives.
    let sampledAlbedo = textureSample(albedoTexture, albedoSampler, input.uv).rgb;
    let baseColor = select(parameters.baseColorAndLight.rgb, sampledAlbedo, parameters.material.z > 0.5);
    let roughness = parameters.material.x;
    let metallic = parameters.material.y;
    let alpha = roughness * roughness;
    let n = normalize(input.normal);
    let v = normalize(parameters.camera.xyz - input.worldPosition);
    let l = normalize(parameters.lightDirection.xyz);
    let noL = clamp(dot(n, l), 0.0, 1.0);
    let noV = clamp(dot(n, v), 0.0, 1.0);
    var radiance = vec3f(0.0);
    let halfVector = l + v;
    if (noL > 0.0 && noV > 0.0 && dot(halfVector, halfVector) > 1e-8) {
        let h = normalize(halfVector);
        let noH = clamp(dot(n, h), 0.0, 1.0);
        let voH = clamp(dot(v, h), 0.0, 1.0);
        let f0 = mix(vec3f(0.04), baseColor, metallic);
        let d = distributionGGX(noH, alpha);
        let g = smithG1(noL, alpha) * smithG1(noV, alpha);
        let f = fresnelSchlick(voH, f0);
        // Keep D, G, F and the Cook-Torrance denominator separate.
        let specular = (d * g * f) / max(4.0 * noL * noV, 1e-8);
        let diffuse = (vec3f(1.0) - f) * (1.0 - metallic) * baseColor / PI;
        var brdf = diffuse + specular;
        if (parameters.material.w > 0.5 && parameters.material.w < 1.5) { brdf = diffuse; }
        if (parameters.material.w > 1.5) { brdf = specular; }
        radiance = brdf * parameters.baseColorAndLight.w * noL;
    }
    // Fixed exposure 1, per-channel Reinhard, then explicit sRGB encoding.
    let mapped = radiance / (vec3f(1.0) + radiance);
    return vec4f(linearToSRGB(mapped), 1.0);
}
