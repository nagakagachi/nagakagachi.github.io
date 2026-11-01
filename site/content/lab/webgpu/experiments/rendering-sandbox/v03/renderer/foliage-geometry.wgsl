struct Root { positionScale:vec4f, info:vec4f }
struct Socket { positionScale:vec4f, rotation:vec4f, ids:vec4u }
struct MeshInfo { vertices:u32, sockets:u32, leaf:u32, level:u32, debug:vec4u }
@group(0) @binding(1) var<storage,read> roots:array<Root>;
@group(0) @binding(2) var<storage,read> items:array<u32>;
@group(0) @binding(3) var<storage,read> vertices:array<f32>;
@group(0) @binding(4) var<storage,read> sockets:array<Socket>;
@group(0) @binding(5) var<uniform> meshInfo:MeshInfo;
fn read3(at:u32)->vec3f{return vec3f(vertices[at],vertices[at+1u],vertices[at+2u]);}
fn rotateQ(v:vec3f,q:vec4f)->vec3f{return v+2.0*cross(q.xyz,cross(q.xyz,v)+q.w*v);}
fn yaw(v:vec3f,a:f32)->vec3f{let c=cos(a);let s=sin(a);return vec3f(c*v.x+s*v.z,v.y,-s*v.x+c*v.z);}
struct PlantVertex { world:vec3f, normal:vec3f, color:vec3f }
fn plantVertex(id:u32,instance:u32)->PlantVertex {
 let leaf=meshInfo.leaf!=0u;
 let treeInstance=select(instance,instance/meshInfo.sockets,leaf);
 let root=roots[items[meshInfo.level*10816u+treeInstance]];
 var variation=u32(root.info.y);var socket:Socket;
 if(leaf){socket=sockets[variation*meshInfo.sockets+instance%meshInfo.sockets];variation=socket.ids.x;}
 let at=(variation*meshInfo.vertices+id)*9u;
 var p=read3(at);var n=read3(at+3u);
 if(leaf){p=rotateQ(p,socket.rotation)*socket.positionScale.w+socket.positionScale.xyz;n=rotateQ(n,socket.rotation);}
 var color=read3(at+6u);
 if(meshInfo.debug.x==1u){let palette=array<vec3f,3>(vec3f(0.9,0.15,0.1),vec3f(0.1,0.8,0.2),vec3f(0.1,0.3,0.9));color=palette[select(meshInfo.level,u32(root.info.z),leaf)];}
 if(meshInfo.debug.x==2u){let id=items[meshInfo.level*10816u+treeInstance]/64u;let h=id*747796405u+2891336453u;color=0.2+0.7*vec3f(f32(h&255u),f32((h>>8u)&255u),f32((h>>16u)&255u))/255.0;}
 if(meshInfo.debug.x==3u){
  let colors=array<vec3f,4>(vec3f(0.1,0.8,0.35),vec3f(0.15,0.45,0.95),vec3f(0.9,0.65,0.1),vec3f(0.75,0.15,0.75));
  color=vec3f(0.65,0.25,0.08);if(leaf){color=colors[meshInfo.level-3u];}
 }
 if(meshInfo.debug.x==4u){
  let colors=array<vec3f,4>(vec3f(0.9,0.15,0.1),vec3f(0.1,0.8,0.2),vec3f(0.1,0.3,0.9),vec3f(0.85,0.6,0.15));
  color=colors[select(u32(root.info.w),meshInfo.level-3u,leaf)];
 }
 return PlantVertex(yaw(p,root.info.x)*root.positionScale.w+root.positionScale.xyz,yaw(n,root.info.x),color);
}
@vertex fn depthMain(@builtin(vertex_index) id:u32,@builtin(instance_index) instance:u32)->@builtin(position) @invariant vec4f {
 return scene.viewProjection*vec4f(plantVertex(id,instance).world,1);
}
