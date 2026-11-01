@group(0) @binding(1) var<storage,read> linePoints:array<vec4f>;
struct Root { positionScale:vec4f, info:vec4f }
@group(0) @binding(2) var<storage,read> lineRoots:array<Root>;
@group(0) @binding(3) var<uniform> lineCount:vec4u;
@vertex fn lineVertex(@builtin(vertex_index) id:u32,@builtin(instance_index) instance:u32)->@builtin(position) vec4f {
 let root=lineRoots[instance];let p=linePoints[u32(root.info.y)*lineCount.x+id].xyz;
 return scene.viewProjection*vec4f(p*root.positionScale.w+root.positionScale.xyz,1);
}
@fragment fn lineFragment()->@location(0) vec4f {return vec4f(vec3f(0.8,0.25,0.03)*bitcast<f32>(lineCount.y),1);}
