const PBR_PI = 3.141592653589793;
fn distributionGGX(noH: f32, alpha: f32) -> f32 {
    let a2=alpha*alpha;
    let denominator=noH*noH*(a2-1.0)+1.0;
    return a2/(PBR_PI*denominator*denominator);
}
fn smithG1(noX: f32, alpha: f32) -> f32 {
    let a2=alpha*alpha;
    return (2.0*noX)/max(noX+sqrt(a2+(1.0-a2)*noX*noX),0.000001);
}
fn fresnelSchlick(voH: f32, f0: vec3f) -> vec3f {
    return f0+(vec3f(1.0)-f0)*pow(1.0-voH,5.0);
}
fn directBRDF(n: vec3f, v: vec3f, l: vec3f, albedo: vec3f, roughness: f32, metallic: f32) -> vec3f {
    let noL=max(dot(n,l),0.0);let noV=max(dot(n,v),0.00001);
    let halfVector=l+v;
    if(noL<=0.0 || dot(halfVector,halfVector)<0.000001) { return vec3f(0.0); }
    let h=normalize(halfVector);let alpha=roughness*roughness;
    let d=distributionGGX(max(dot(n,h),0.0),alpha);
    let g=smithG1(noL,alpha)*smithG1(noV,alpha);
    let f=fresnelSchlick(max(dot(v,h),0.0),mix(vec3f(0.04),albedo,metallic));
    // D・G・FとCook-Torranceの分母は分離した素直な式とする。
    let specular=d*g*f/max(4.0*noL*noV,0.000001);
    let diffuse=(vec3f(1.0)-f)*(1.0-metallic)*albedo/PBR_PI;
    return (diffuse+specular)*noL;
}
