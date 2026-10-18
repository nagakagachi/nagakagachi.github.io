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
@vertex fn vertexMain(@location(0) position: vec3f) -> @builtin(position) vec4f {
    return frame.lightViewProjection * object.model * vec4f(position, 1.0);
}
