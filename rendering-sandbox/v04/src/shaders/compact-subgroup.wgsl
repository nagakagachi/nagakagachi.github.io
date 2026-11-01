// WebGPU向けでは共有宣言の前にenable subgroupsを付加する。nativeのNagaには不要。
@compute @workgroup_size(64)
fn cullMain(@builtin(global_invocation_id) gid: vec3u, @builtin(subgroup_invocation_id) lane: u32) {
    let descriptor = packCandidate(gid.x);
    let accepted = tileVisible(gid.x, descriptor);
    let flag = select(0u, 1u, accepted);

    // 不可視・範囲外のlaneも、すべてのsubgroup集約処理に参加する。
    let rank = subgroupExclusiveAdd(flag);
    let count = subgroupAdd(flag);
    let leader = (lane == 0u);
    var base = 0u;
    if (leader && count > 0u) {
        base = atomicAdd(&arguments.instanceCount, count);
    }
    base = subgroupBroadcastFirst(base);
    if (accepted) {
        visible[base + rank] = descriptor;
    }
}
