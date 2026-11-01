@group(0) @binding(0) var<uniform> ss: ScreenParams;
@group(0) @binding(1) var depthMap: texture_depth_2d;
@group(0) @binding(2) var mask: texture_storage_2d<rgba8unorm, write>;
@group(0) @binding(3) var<storage, read_write> totals: array<atomic<u32>>;
var<workgroup> partial: array<vec4u, 64>;

// 深度はInfinity-far Reversed Z、near=1m。比較の厚みはビューZのm単位。
// ワールド空間の各サンプルを投影する。距離対応OFFは旧来の等間隔・固定厚み。
// スクリーン上の整数画素から求めるIGN。フレーム番号を含めず、静止時は固定する。
// Jorge Jimenez, Next Generation Post Processing in Call of Duty: Advanced Warfare (2014)
fn interleavedGradientNoise(pixel: vec2u) -> f32 {
    return fract(52.9829189 * fract(dot(vec2f(pixel), vec2f(0.06711056, 0.00583715))));
}
fn tracePixel(id: vec2u) -> vec4f {
    let full = ss.dimensions.xy;
    let size = ss.dimensions.zw;
    let originPixel = min(vec2u((vec2f(id) + 0.5) * vec2f(full) / vec2f(size)), full - 1u);
    let raw = textureLoad(depthMap, vec2i(originPixel), 0);
    if (raw <= 0.0) { return vec4f(1, 0, 0, 1); }
    let uv = (vec2f(originPixel) + 0.5) / vec2f(full);
    let h = ss.inverseViewProjection * vec4f(uv * vec2f(2, -2) + vec2f(-1, 1), raw, 1);
    let origin = h.xyz / h.w;
    let viewZ = 1.0 / raw;
    if (ss.adaptive.x == 0.0 && ss.display.z == 0u && viewZ < ss.trace.w * 0.9) {
        return vec4f(1, 0, 4.0 / 255.0, 1);
    }
    // 初期区間は視点距離に関係なく固定幅。その後の二次配置だけを遠方へ広げる。
    // 全区間を単純にスケールすると、最初のサンプルから接触部分を飛び越えるため。
    let adaptive = ss.adaptive.x != 0.0;
    let scale = select(1.0, max(1.0, viewZ / ss.adaptive.y), adaptive);
    let rayLength = min(ss.trace.x * scale, ss.adaptive.z);
    let baseThickness = min(ss.trace.y * scale, ss.adaptive.w);
    let prefixCount = select(0u, min(u32(ss.contact.y), ss.options.y-1u), adaptive);
    let prefixLength = min(f32(prefixCount)*ss.contact.x, rayLength*0.5);
    let tailCount = ss.options.y-prefixCount;
    let phase = select(0.5, interleavedGradientNoise(originPixel), ss.display.w != 0u);
    var taps = 0u;
    for (var i = 0u; i < ss.options.y; i++) {
        var lo = f32(i) * rayLength / f32(ss.options.y);
        var hi = f32(i+1u) * rayLength / f32(ss.options.y);
        if (adaptive) {
            if (i < prefixCount) {
                lo = f32(i)*prefixLength/f32(prefixCount);
                hi = f32(i+1u)*prefixLength/f32(prefixCount);
            } else {
                let a = f32(i-prefixCount)/f32(tailCount);
                let b = f32(i-prefixCount+1u)/f32(tailCount);
                lo = prefixLength+(rayLength-prefixLength)*a*a;
                hi = prefixLength+(rayLength-prefixLength)*b*b;
            }
        }
        let distance = ss.trace.z + mix(lo, hi, phase);
        // 近い数ステップには遠景用の厚みを使わず、コンタクトの過剰な太りを抑える。
        // 後半は視点距離とサンプル区間幅の両方へ追従し、上限で誤遮蔽を制限する。
        var thickness = ss.trace.y;
        if (adaptive && i >= prefixCount) {
            thickness = min(ss.adaptive.w, baseThickness+(hi-lo)*ss.contact.z);
        }
        let clip = ss.viewProjection * vec4f(origin + ss.light.xyz * distance, 1);
        if (clip.w < 1.0 || clip.z < 0.0 || clip.z > clip.w) {
            return vec4f(1, f32(taps) / 16.0, 3.0 / 255.0, 1);
        }
        let sampleUV = clip.xy / clip.w * vec2f(0.5, -0.5) + 0.5;
        if (any(sampleUV < vec2f(0)) || any(sampleUV >= vec2f(1))) {
            return vec4f(1, f32(taps) / 16.0, 3.0 / 255.0, 1);
        }
        let pixel = vec2u(sampleUV * vec2f(full));
        if (all(pixel == originPixel)) { continue; }
        let sampleRaw = textureLoad(depthMap, vec2i(pixel), 0);
        taps++;
        if (sampleRaw > 0.0) {
            let difference = clip.w - 1.0 / sampleRaw;
            // 高いビューZでも深度復元誤差を自己遮蔽と誤認しないための丸め誤差幅。
            let epsilon = max(0.0001, (1.0 / sampleRaw)*0.000002);
            if (difference > epsilon && difference < thickness) {
                // 画面端では遮蔽情報が急に失われるため、8pxの範囲で弱める。
                let edge = min(min(sampleUV.x, 1.0-sampleUV.x)*f32(full.x),
                               min(sampleUV.y, 1.0-sampleUV.y)*f32(full.y));
                let visibility = 1.0-smoothstep(0.0, 8.0, edge);
                let contactVisibility = select(1.0, visibility, adaptive && i < prefixCount);
                return vec4f(visibility, f32(taps)/16.0, 1.0/255.0, contactVisibility);
            }
        }
    }
    return vec4f(1, f32(taps) / 16.0, 2.0 / 255.0, 1);
}

@compute @workgroup_size(8, 8)
fn traceMain(@builtin(global_invocation_id) id: vec3u, @builtin(local_invocation_index) lane: u32) {
    var value = vec4f(1,0,0,0);
    let valid = all(id.xy < ss.dimensions.zw);
    if (valid) {
        value = tracePixel(id.xy);
        textureStore(mask, vec2i(id.xy), value);
    }
    if (ss.options.z != 0u) {
        let status = u32(round(value.z * 255.0));
        partial[lane] = vec4u(u32(valid && status != 0u && status != 4u), u32(round(value.y*16.0)) + u32(valid),
                            u32(valid && status == 1u), u32(valid && status == 3u));
        workgroupBarrier();
        // 全laneで共有メモリを縮約し、大域Atomicは1workgroupにつき最大4回。
        for (var stride=32u; stride>0u; stride/=2u) {
            if (lane<stride) { partial[lane] += partial[lane+stride]; }
            workgroupBarrier();
        }
        if (lane == 0u) {
            for (var channel=0u; channel<4u; channel++) {
                if (partial[0][channel] > 0u) { atomicAdd(&totals[channel], partial[0][channel]); }
            }
        }
    }
}
