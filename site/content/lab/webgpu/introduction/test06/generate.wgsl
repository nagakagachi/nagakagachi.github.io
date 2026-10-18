@group(0) @binding(0) var outputTexture: texture_storage_2d<rgba8unorm, write>;
fn segment(p: vec2f, a: vec2f, b: vec2f) -> f32 {
    let ab = b - a;
    let h = clamp(dot(p - a, ab) / dot(ab, ab), 0.0, 1.0);
    return length(p - a - ab * h);
}
fn roundedBox(p: vec2f, halfSize: vec2f, radius: f32) -> f32 {
    let q = abs(p) - halfSize + radius;
    return length(max(q, vec2f(0.0))) + min(max(q.x, q.y), 0.0) - radius;
}
fn coverage(distance: f32, aa: f32) -> f32 {
    return 1.0 - smoothstep(-aa, aa, distance);
}
@compute @workgroup_size(8, 8, 1)
fn computeMain(@builtin(global_invocation_id) id: vec3u) {
    let size = textureDimensions(outputTexture);
    if (any(id.xy >= size)) { return; }
    let uv = (vec2f(id.xy) + 0.5) / vec2f(size);
    let p = uv * 2.0 - 1.0;
    let aa = 2.0 / f32(size.x);
    let frame = abs(roundedBox(p, vec2f(0.83), 0.12)) - 0.025;
    let shaft = segment(p, vec2f(0.0, 0.38), vec2f(0.0, -0.40));
    let left = segment(p, vec2f(-0.25, -0.13), vec2f(0.0, -0.40));
    let right = segment(p, vec2f(0.25, -0.13), vec2f(0.0, -0.40));
    let arrow = min(shaft, min(left, right)) - 0.055;
    let circle = length(p - vec2f(0.48, 0.48)) - 0.11;
    var color = vec3f(0.035, 0.12, 0.14);
    color = mix(color, vec3f(0.20, 0.42, 0.43), coverage(frame, aa));
    color = mix(color, vec3f(0.82, 0.90, 0.83), coverage(arrow, aa));
    color = mix(color, vec3f(0.58, 0.65, 0.88), coverage(circle, aa));
    textureStore(outputTexture, vec2i(id.xy), vec4f(color, 1.0));
}
