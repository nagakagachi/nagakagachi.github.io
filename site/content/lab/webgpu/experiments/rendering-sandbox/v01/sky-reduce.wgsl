@group(0) @binding(0) var<storage, read> partials: array<vec4f>;
@group(0) @binding(1) var<storage, read_write> result: SkySH;
var<workgroup> sums: array<vec4f, SKY_SH_COEFFICIENTS * 64u>;

@compute @workgroup_size(64)
fn reduceSky(@builtin(local_invocation_index) lane: u32) {
    let groups = arrayLength(&partials) / SKY_SH_COEFFICIENTS;
    for (var c = 0u; c < SKY_SH_COEFFICIENTS; c++) {
        var sum = vec4f(0.0);
        for (var i = lane; i < groups; i += 64u) { sum += partials[i * SKY_SH_COEFFICIENTS + c]; }
        sums[c * 64u + lane] = sum;
    }
    workgroupBarrier();
    for (var stride = 32u; stride > 0u; stride /= 2u) {
        if (lane < stride) {
            for (var c = 0u; c < SKY_SH_COEFFICIENTS; c++) { sums[c * 64u + lane] += sums[c * 64u + lane + stride]; }
        }
        workgroupBarrier();
    }
    if (lane == 0u) {
        let normalization = 12.5663706144 / sums[0].w;
        for (var c = 0u; c < SKY_SH_COEFFICIENTS; c++) {
            // Lambertの1/piを含む帯域係数はl=0で1、l=1で2/3、l=2で1/4。
            let kernel = select(select(0.25, 0.6666666667, c < 4u), 1.0, c == 0u);
            result.coefficients[c] = vec4f(sums[c * 64u].rgb * normalization * kernel, 0.0);
        }
    }
}
