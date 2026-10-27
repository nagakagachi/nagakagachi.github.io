@group(0) @binding(0) var brdfLut: texture_storage_2d<rgba16float,write>;
@compute @workgroup_size(8,8)
fn integrateBRDF(@builtin(global_invocation_id) id: vec3u) {
    let size=textureDimensions(brdfLut);if(any(id.xy>=size)) { return; }
    let noV=max((f32(id.x)+0.5)/f32(size.x),0.0001);
    let roughness=max((f32(id.y)+0.5)/f32(size.y),0.04);
    let v=vec3f(sqrt(1.0-noV*noV),0,noV);let n=vec3f(0,0,1);
    var ab=vec2f(0.0);
    for(var i=0u;i<256u;i++) {
        let h=importanceGGX(hammersley(i,256u),n,roughness);
        let l=normalize(2.0*dot(v,h)*h-v);let noL=max(l.z,0.0);
        let noH=max(h.z,0.00001);let voH=max(dot(v,h),0.0);
        if(noL>0.0) {
            let alpha=roughness*roughness;
            let visibility=smithG1(noL,alpha)*smithG1(noV,alpha)*voH/(noH*noV);
            let fc=pow(1.0-voH,5.0);
            ab+=vec2f(1.0-fc,fc)*visibility;
        }
    }
    textureStore(brdfLut,vec2i(id.xy),vec4f(ab/256.0,0,1));
}
