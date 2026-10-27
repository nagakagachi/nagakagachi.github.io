fn hammersley(i: u32, count: u32) -> vec2f {
    return vec2f(f32(i)/f32(count),f32(reverseBits(i))*2.3283064365386963e-10);
}
fn importanceGGX(xi: vec2f, n: vec3f, roughness: f32) -> vec3f {
    let alpha=roughness*roughness;let a2=alpha*alpha;
    let phi=2.0*PBR_PI*xi.x;
    let cosTheta=sqrt((1.0-xi.y)/(1.0+(a2-1.0)*xi.y));
    let sinTheta=sqrt(max(0.0,1.0-cosTheta*cosTheta));
    let up=select(vec3f(0,0,1),vec3f(1,0,0),abs(n.z)>0.999);
    let t=normalize(cross(up,n));let b=cross(n,t);
    return normalize(t*cos(phi)*sinTheta+b*sin(phi)*sinTheta+n*cosTheta);
}
