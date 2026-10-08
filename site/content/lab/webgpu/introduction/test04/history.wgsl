@group(0) @binding(0) var sceneTexture: texture_2d<f32>;
@group(0) @binding(1) var previousTexture: texture_2d<f32>;
@group(0) @binding(2) var nextTexture: texture_storage_2d<rgba8unorm, write>;
// time, delta seconds, half-life seconds, aspect ratio
@group(0) @binding(3) var<uniform> options: vec4f;

@compute @workgroup_size(8, 8, 1)
fn computeMain(@builtin(global_invocation_id) id: vec3u) {
    let size = textureDimensions(nextTexture);
    if (any(id.xy >= size)) { return; }
    let p = vec2i(id.xy);
    let weights = array<f32, 3>(1.0, 2.0, 1.0);
    var history = vec3f(0.0);
    for (var y = -1; y <= 1; y++) {
        for (var x = -1; x <= 1; x++) {
            let q = clamp(p + vec2i(x, y), vec2i(0), vec2i(size) - 1);
            history += textureLoad(previousTexture, q, 0).rgb * weights[u32(x + 1)] * weights[u32(y + 1)];
        }
    }
    let retention = exp2(-options.y / options.z);
    let scene = textureLoad(sceneTexture, p, 0).rgb;
    let color = min(history / 16.0 * retention + scene * options.y * 12.0, vec3f(1.0));
    textureStore(nextTexture, p, vec4f(color, 1.0));
}
