struct PrimitiveConfig { shape: vec4f, info: vec4u }
struct PrimitiveArgs { indexCount: u32, instanceCount: u32, firstIndex: u32, baseVertex: i32, firstInstance: u32 }
@group(0) @binding(1) var<uniform> config: PrimitiveConfig;
@group(0) @binding(2) var<storage, read> requests: array<PrimitiveInstance>;
@group(0) @binding(3) var<storage, read_write> instances: array<PrimitiveInstance>;
@group(0) @binding(4) var<storage, read_write> visible: array<u32>;
@group(0) @binding(5) var<storage, read_write> args: PrimitiveArgs;

@compute @workgroup_size(4)
fn placePrimitives(@builtin(global_invocation_id) id: vec3u) {
    if (id.x >= config.info.x) { return; }
    var item = requests[id.x];
    if (item.position.w != 0.0) {
        // カメラ依存の標高段を使わず、同じ生成式の1m版で根元を固定する。
        item.position.y += proceduralTerrainHeight(item.position.xz, config.info.y,
            config.shape.x, config.shape.y, 1.0);
    }
    instances[id.x] = item;
}

fn primitiveVisible(item: PrimitiveInstance) -> bool {
    let halfSize = item.scale.xyz * 0.5;
    let center = item.position.xyz + primitiveRotate(item.rotation, vec3f(0, halfSize.y, 0));
    let extent = abs(primitiveRotate(item.rotation, vec3f(halfSize.x, 0, 0)))
        + abs(primitiveRotate(item.rotation, vec3f(0, halfSize.y, 0)))
        + abs(primitiveRotate(item.rotation, vec3f(0, 0, halfSize.z)));
    if (scene.layoutInfo.w != 0u) {
        for (var p = 0u; p < 6u; p++) {
            let plane = scene.planes[p];
            if (dot(plane.xyz, center) + plane.w + dot(abs(plane.xyz), extent) < 0.0) { return false; }
        }
    }
    if (scene.shadowCasterVolumeInfo.y != 0u) {
        for (var p = 0u; p < scene.shadowCasterVolumeInfo.x; p++) {
            let plane = scene.shadowCasterVolumePlanes[p];
            if (dot(plane.xyz, center) + plane.w + dot(abs(plane.xyz), extent) < 0.0) { return false; }
        }
    }
    return true;
}

@compute @workgroup_size(1)
fn cullPrimitives() {
    var count = 0u;
    // 初版の4本には1スレッドの安定順走査で十分。可視IDとIndirect引数にAtomicは不要。
    for (var id = 0u; id < config.info.x; id++) {
        if (primitiveVisible(instances[id])) { visible[count] = id; count++; }
    }
    args = PrimitiveArgs(config.info.z, count, 0u, 0, 0u);
}
