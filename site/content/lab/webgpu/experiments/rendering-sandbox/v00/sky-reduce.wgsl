@group(0) @binding(0) var<storage, read> partials: array<vec4f>;
@group(0) @binding(1) var<storage, read_write> result: SkySH;
var<workgroup> sums: array<vec4f, 256>;

@compute @workgroup_size(64)
fn reduceSky(@builtin(local_invocation_index) lane: u32) {
    let groups = arrayLength(&partials) / 4u;
    for (var c = 0u; c < 4u; c++) {
        var sum = vec4f(0.0);
        for (var i = lane; i < groups; i += 64u) { sum += partials[i * 4u + c]; }
        sums[c * 64u + lane] = sum;
    }
    workgroupBarrier();
    for (var stride = 32u; stride > 0u; stride /= 2u) {
        if (lane < stride) {
            for (var c = 0u; c < 4u; c++) { sums[c * 64u + lane] += sums[c * 64u + lane + stride]; }
        }
        workgroupBarrier();
    }
    if (lane == 0u) {
        let normalization = 12.5663706144 / sums[0].w;
        for (var c = 0u; c < 4u; c++) {
            // clamped cosineの畳み込みはA0=pi、A1=2pi/3。Lambertの1/piもここで含める。
            let kernel = select(0.6666666667, 1.0, c == 0u);
            result.coefficients[c] = vec4f(sums[c * 64u].rgb * normalization * kernel, 0.0);
        }
    }
}
