struct Prefilter { values: vec4f, } // roughness、予約。
@group(0) @binding(0) var sourceSky: texture_2d<f32>;
@group(0) @binding(1) var filteredSky: texture_storage_2d<rgba16float,write>;
@group(0) @binding(2) var<uniform> prefilter: Prefilter;
@compute @workgroup_size(8,8)
fn prefilterMain(@builtin(global_invocation_id) id: vec3u) {
    let size=textureDimensions(filteredSky);if(any(id.xy>=size)) { return; }
    // gutterは全Mipで寸法の1/16。隣接面への折返しを事前に書き込む。
    let border=i32(size.x)/16;
    let interior=i32(size.x)-2*border;
    let cell=octahedralTexel(vec2i(id.xy)-border,interior);
    let n=octahedralDirection((vec2f(cell)+0.5)/f32(interior));
    let roughness=prefilter.values.x;
    var sum=vec3f(0.0);var weight=0.0;
    if(roughness==0.0) { sum=sampleOctLevel(sourceSky,n,0);weight=1.0; }
    else {
        // N=V=Rを仮定したSplit-Sumの環境側積分。各Mipを元の天空から直接生成する。
        for(var i=0u;i<64u;i++) {
            let h=importanceGGX(hammersley(i,64u),n,roughness);
            let l=normalize(2.0*dot(n,h)*h-n);let noL=max(dot(n,l),0.0);
            if(noL>0.0) { sum+=sampleOctLevel(sourceSky,l,0)*noL;weight+=noL; }
        }
    }
    textureStore(filteredSky,vec2i(id.xy),vec4f(sum/max(weight,0.00001),1));
}
