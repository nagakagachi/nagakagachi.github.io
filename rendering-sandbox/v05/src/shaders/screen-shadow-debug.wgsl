@group(0) @binding(0) var screenMask: texture_2d<f32>;
@group(0) @binding(1) var<uniform> ss: ScreenParams;
@vertex fn screenDebugVertex(@builtin(vertex_index) id:u32) -> @builtin(position) vec4f {
    let p = array<vec2f,3>(vec2f(-1,-1),vec2f(3,-1),vec2f(-1,3));
    return vec4f(p[id],0,1);
}
@fragment fn screenDebugFragment(@builtin(position) pixel:vec4f) -> @location(0) vec4f {
    if (ss.options.x == 0u) { return vec4f(1); }
    let coord=min(vec2u(pixel.xy/vec2f(ss.dimensions.xy)*vec2f(ss.dimensions.zw)),ss.dimensions.zw-1u);
    let v=textureLoad(screenMask,vec2i(coord),0);
    if (ss.display.x == 4u) { return vec4f(v.aaa,1); }
    if (ss.display.x == 1u) { return vec4f(v.xxx,1); }
    if (ss.display.x == 2u) {
        let t=v.y*16.0/f32(ss.options.y);
        return vec4f(t, 1.0-abs(t*2.0-1.0), 1.0-t,1);
    }
    let colors=array<vec3f,4>(vec3f(0.06),vec3f(1,0.15,0.1),vec3f(0.15,0.75,0.2),
                             vec3f(0.2,0.4,1));
    return vec4f(colors[min(u32(round(v.z*255.0)),3u)],1);
}
