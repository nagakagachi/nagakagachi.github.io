@group(0) @binding(0) var source: texture_2d<f32>;
@group(0) @binding(1) var<uniform> exposure: vec4f;
@group(0) @binding(2) var<uniform> mip: vec4u;
@vertex fn vs(@builtin(vertex_index) id:u32)->@builtin(position) vec4f {let p=array<vec2f,3>(vec2f(-1,-1),vec2f(3,-1),vec2f(-1,3))[id];return vec4f(p,0,1);}
@fragment fn fs(@builtin(position) pixel:vec4f)->@location(0) vec4f {
 let size=textureDimensions(source,mip.x);
 let uv=(pixel.xy-vec2f(mip.yz))/vec2f(f32(mip.w));
 let p=clamp(vec2i(uv*vec2f(size)),vec2i(0),vec2i(size)-1);
 let hdr=max(textureLoad(source,p,i32(mip.x)).rgb*exposure.x,vec3f(0));
 let color=clamp(hdr*(2.51*hdr+0.03)/(hdr*(2.43*hdr+0.59)+0.14),vec3f(0),vec3f(1));
 return vec4f(select(1.055*pow(color,vec3f(1.0/2.4))-0.055,12.92*color,color<=vec3f(0.0031308)),1);
}
