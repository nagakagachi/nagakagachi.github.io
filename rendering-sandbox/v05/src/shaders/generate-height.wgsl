struct HeightJob {
    rect: vec4i, // 世界格子での原点X/Zと矩形の幅/高さ。
    config: vec4u, // 標高段、uintシード、予約、予約。
    shape: vec4f, // サンプル間隔、標高振幅、山のスケール、予約。
}
@group(0) @binding(0) var<uniform> job: HeightJob;
@group(0) @binding(1) var<storage, read_write> heights: array<u32>;

@compute @workgroup_size(8, 8)
fn generateMain(@builtin(global_invocation_id) gid: vec3u) {
    if (gid.x >= u32(job.rect.z) / 2u || gid.y >= u32(job.rect.w)) { return; }
    let cell = job.rect.xy + vec2i(i32(gid.x * 2u), i32(gid.y));
    let first = proceduralTerrainHeight(vec2f(cell) * job.shape.x, job.config.y, job.shape.y, job.shape.z, job.shape.x);
    let second = proceduralTerrainHeight(vec2f(cell + vec2i(1, 0)) * job.shape.x, job.config.y, job.shape.y, job.shape.z, job.shape.x);
    let physical = vec2u(cell) & vec2u(1023u);
    let word = job.config.x * 524288u + physical.y * 512u + physical.x / 2u;
    // 2個のFP16を1語として書く。他の矩形・invocationと書込先が重ならず、Atomic不要。
    heights[word] = pack2x16float(vec2f(first, second));
}
