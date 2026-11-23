struct PrimitiveOutput {
    @builtin(position) @invariant clip: vec4f,
    @location(0) world: vec3f,
    @location(1) normal: vec3f,
    @location(2) albedo: vec3f,
    @location(3) material: vec2f,
}
@vertex
fn primitiveVertex(@builtin(vertex_index) vertex: u32, @builtin(instance_index) instance: u32) -> PrimitiveOutput {
    let s = primitiveSurface(vertex, instance);
    return PrimitiveOutput(scene.viewProjection * vec4f(s.world, 1), s.world, s.normal, s.albedo,
        vec2f(s.roughness, s.metallic));
}
@fragment
fn primitiveFragment(input: PrimitiveOutput) -> @location(0) vec4f {
    return shadeOpaqueSurface(input.world, normalize(input.normal), input.albedo,
        input.material.x, input.material.y, input.clip.xy);
}
