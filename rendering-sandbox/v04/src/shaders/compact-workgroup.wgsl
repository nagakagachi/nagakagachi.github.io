// subgroup未対応時の経路。共有メモリでBlelloch scanを行い、局所Atomicは使わない。
var<workgroup> scan: array<u32, 64>;
var<workgroup> groupBase: u32;

@compute @workgroup_size(64)
fn cullMain(@builtin(global_invocation_id) gid: vec3u, @builtin(local_invocation_index) lane: u32) {
    let descriptor = packCandidate(gid.x);
    let accepted = tileVisible(gid.x, descriptor);
    scan[lane] = select(0u, 1u, accepted);
    workgroupBarrier();

    // 上向きの集約で可視数を求める。すべてのlaneが各バリアへ到達する。
    for (var stride = 1u; stride < 64u; stride *= 2u) {
        let i = (lane + 1u) * stride * 2u - 1u;
        if (i < 64u) { scan[i] += scan[i - stride]; }
        workgroupBarrier();
    }
    if (lane == 0u) {
        let count = scan[63];
        scan[63] = 0u;
        groupBase = 0u;
        if (count > 0u) { groupBase = atomicAdd(&arguments.instanceCount, count); }
    }
    workgroupBarrier();

    // 下向きの展開で、各laneより前の可視数を出力先オフセットとして求める。
    for (var stride = 32u; stride > 0u; stride /= 2u) {
        let i = (lane + 1u) * stride * 2u - 1u;
        if (i < 64u) {
            let left = scan[i - stride];
            scan[i - stride] = scan[i];
            scan[i] += left;
        }
        workgroupBarrier();
    }
    if (accepted) {
        visible[groupBase + scan[lane]] = descriptor;
    }
}
