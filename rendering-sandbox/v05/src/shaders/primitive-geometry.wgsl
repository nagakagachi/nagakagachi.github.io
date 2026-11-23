@group(0) @binding(1) var<storage, read> primitiveVertices: array<PrimitiveVertex>;
@group(0) @binding(2) var<storage, read> primitiveInstances: array<PrimitiveInstance>;
@group(0) @binding(3) var<storage, read> primitiveVisibleIDs: array<u32>;
struct PrimitiveSurface { world: vec3f, normal: vec3f, albedo: vec3f, roughness: f32, metallic: f32 }
fn primitiveSurface(vertex: u32, instance: u32) -> PrimitiveSurface {
    let item = primitiveInstances[primitiveVisibleIDs[instance]];
    let v = primitiveVertices[vertex];
    let local = v.position.xyz * item.scale.xyz + vec3f(0, item.scale.y * 0.5, 0);
    let world = item.position.xyz + primitiveRotate(item.rotation, local);
    let normal = normalize(primitiveRotate(item.rotation, v.normal.xyz / item.scale.xyz));
    return PrimitiveSurface(world, normal, item.albedo.rgb, item.albedo.w, item.scale.w);
}
@vertex
fn primitiveDepth(@builtin(vertex_index) vertex: u32, @builtin(instance_index) instance: u32)
    -> @builtin(position) @invariant vec4f {
    return scene.viewProjection * vec4f(primitiveSurface(vertex, instance).world, 1);
}
