import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
// ブラウザ向けの.js参照を、このCPUテスト内だけで原本の.tsへ解決する。
const hook=registerHooks({resolve(specifier,context,next){
 if(specifier==='./render-math.js'&&context.parentURL?.endsWith('/v02/cascaded-shadows.ts'))return next('./render-math.ts',context);
 return next(specifier,context);
}});
const {buildCascades,casterPlanes}=await import('../site/content/lab/webgpu/experiments/rendering-sandbox/v02/cascaded-shadows.ts');
hook.deregister();
import { lightDirection, skyRayFrame } from '../site/content/lab/webgpu/experiments/rendering-sandbox/v02/render-math.ts';
const dot=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0);
function corners(eye,yaw,pitch,fov,near,far){
 const r=skyRayFrame(yaw,pitch,1.7,fov),out=[];
 for(const z of [near,far])for(const y of [-1,1])for(const x of [-1,1])out.push(eye.map((v,i)=>v+z*(r[i]+x*r[4+i]+y*r[8+i])));
 return out;
}
test('受光体積と光源側の全キャスター候補を保守的に保持する',()=>{
 for(const yaw of [0,0.7,2.5])for(const pitch of [-0.6,0,0.8])for(const elevation of [1,30,85]){
  const points=corners([120,200,-75],yaw,pitch,Math.PI/3,1,800),light=lightDirection(63,elevation),planes=casterPlanes(points,light);
  assert.ok(planes.length>0&&planes.length<=64);
  for(let i=0;i<points.length;i++)for(const t of [0,10,1000,50000]){
   const p=points[i].map((v,j)=>v+t*light[j]);
   for(let k=0;k<planes.length;k+=4)assert.ok(dot([...planes.slice(k,k+3)],p)+planes[k+3]>-0.03);
  }
  // フラスタムの内部も保持し、無関係な外部点をすべて残す退化実装を検出する。
  const center=[0,1,2].map(j=>points.reduce((s,p)=>s+p[j],0)/8);
  let rejected=0;
  for(const d of [[1,0,0],[-1,0,0],[0,0,1],[0,0,-1],[0,-1,0]]){
   const p=center.map((v,j)=>v+d[j]*100000);
   for(let k=0;k<planes.length;k+=4)if(dot([...planes.slice(k,k+3)],p)+planes[k+3]<0){rejected++;break;}
  }
  assert.ok(rejected>0);
 }
});
test('4カスケードの分割・Atlas解像度と受光領域の被覆が整合する',()=>{
 const eye=[0,200,0],yaw=0.2,pitch=-0.1,fov=Math.PI/3;
 const cascades=buildCascades(eye,yaw,pitch,fov,1.7,lightDirection(60,30),4096,24000);
 assert.equal(cascades.length,4);assert.equal(cascades[3].split,4096);
 for(let i=0;i<4;i++){
  const start=i===0?1:(i===1?1:cascades[i-2].split)+(cascades[i-1].split-(i===1?1:cascades[i-2].split))*0.9;
  const points=corners(eye,yaw,pitch,fov,start,cascades[i].split),m=cascades[i].matrix;
  for(const p of points){
   const clip=[0,1,2].map(row=>p[0]*m[row]+p[1]*m[row+4]+p[2]*m[row+8]+m[row+12]);
   assert.ok(Math.abs(clip[0])<=1&&Math.abs(clip[1])<=1&&clip[2]>=0&&clip[2]<=1);
  }
 }
});

test('カメラ回転で各カスケードの投影スケールが変わらない',()=>{
 const scales=[];
 for(const yaw of [0,0.1,0.7,1.5,3]){
  const cascades=buildCascades([0,200,0],yaw,0.2,Math.PI/3,1.7,lightDirection(60,30),4096,24000);
  scales.push(cascades.map(c=>Math.hypot(c.matrix[0],c.matrix[4],c.matrix[8])));
 }
 scales.forEach(value=>assert.deepEqual(value,scales[0]));
});
