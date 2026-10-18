struct Frame {
    viewProjection: mat4x4f,
    lightViewProjection: mat4x4f,
    camera: vec4f,
    light: vec4f,
    shadow: vec4f, // PCF radius, depth bias, normal bias, map resolution
    flags: vec4f, // shadows enabled
};
struct ObjectData { model: mat4x4f, colorRoughness: vec4f, };
@group(0) @binding(0) var<uniform> frame: Frame;
@group(1) @binding(0) var<uniform> object: ObjectData;
@group(2) @binding(0) var shadowMap: texture_depth_2d;
@group(2) @binding(1) var shadowSampler: sampler_comparison;
const PI = 3.141592653589793;
struct VertexOutput {
    @builtin(position) position: vec4f,
    @location(0) worldPosition: vec3f,
    @location(1) normal: vec3f,
};
@vertex fn vertexMain(@location(0) position: vec3f, @location(1) normal: vec3f) -> VertexOutput {
    var output: VertexOutput;
    let world = object.model * vec4f(position, 1.0);
    output.position = frame.viewProjection * world;
    output.worldPosition = world.xyz;
    // Model transforms contain rotation and translation only.
    output.normal = (object.model * vec4f(normal, 0.0)).xyz;
    return output;
}
fn shadowVisibility(position: vec3f, normal: vec3f) -> f32 {
    if (frame.flags.x < 0.5) { return 1.0; }
    let offsetPosition = position + normal * frame.shadow.z;
    let clip = frame.lightViewProjection * vec4f(offsetPosition, 1.0);
    let ndc = clip.xyz / clip.w;
    let uv = vec2f(ndc.x * 0.5 + 0.5, 0.5 - ndc.y * 0.5);
    if (any(uv < vec2f(0.0)) || any(uv > vec2f(1.0)) || ndc.z < 0.0 || ndc.z > 1.0) { return 1.0; }
    // Reversed Z: positive receiver bias moves the comparison toward the light.
    let reference = ndc.z + frame.shadow.y;
    let radius = i32(frame.shadow.x);
    var visibility = 0.0;
    var count = 0.0;
    for (var y = -radius; y <= radius; y++) {
        for (var x = -radius; x <= radius; x++) {
            let sampleUV = uv + vec2f(f32(x), f32(y)) / frame.shadow.w;
            if (any(sampleUV < vec2f(0.0)) || any(sampleUV > vec2f(1.0))) {
                visibility += 1.0;
            } else {
                visibility += textureSampleCompareLevel(shadowMap, shadowSampler, sampleUV, reference);
            }
            count += 1.0;
        }
    }
    return visibility / count;
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
    let n = normalize(input.normal);
    let v = normalize(frame.camera.xyz - input.worldPosition);
    let l = normalize(frame.light.xyz);
    let noL = clamp(dot(n,l),0.0,1.0);
    let noV = clamp(dot(n,v),0.0,1.0);
    let halfVector = l + v;
    var radiance = vec3f(0.0);
    if (noL > 0.0 && noV > 0.0 && dot(halfVector,halfVector) > 1e-8) {
        let h = normalize(halfVector);
        let noH = clamp(dot(n,h),0.0,1.0);
        let voH = clamp(dot(v,h),0.0,1.0);
        let alpha = object.colorRoughness.w * object.colorRoughness.w;
        let d = distributionGGX(noH,alpha);
        let g = smithG1(noL,alpha) * smithG1(noV,alpha);
        let f = fresnelSchlick(voH,vec3f(0.04));
        let specular = d * g * f / max(4.0 * noL * noV,1e-8);
        let diffuse = (vec3f(1.0)-f) * object.colorRoughness.rgb / PI;
        let visibility = shadowVisibility(input.worldPosition,n);
        radiance = (diffuse + specular) * frame.light.w * noL * visibility;
    }
    let mapped = radiance / (vec3f(1.0)+radiance);
    return vec4f(linearToSRGB(mapped),1.0);
}
