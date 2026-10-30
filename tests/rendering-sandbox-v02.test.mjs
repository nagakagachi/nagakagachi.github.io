import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
// ブラウザ向けの.js参照を、このCPUテスト内だけで原本の.tsへ解決する。
const hook=registerHooks({resolve(specifier,context,next){
 if(specifier==='./render-math.js'&&context.parentURL?.endsWith('/v02/cascaded-shadows.ts'))return next('./render-math.ts',context);
 return next(specifier,context);
}});
const {buildCascades,buildShadowCasterVolumeCullingPlanes}=await import('../site/content/lab/webgpu/experiments/rendering-sandbox/v02/cascaded-shadows.ts');
hook.deregister();
import { lightDirection, skyRayFrame } from '../site/content/lab/webgpu/experiments/rendering-sandbox/v02/render-math.ts';
const dot=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0);
function corners(eye,yaw,pitch,fov,near,far){
 const r=skyRayFrame(yaw,pitch,1.7,fov),out=[];
 for(const z of [near,far])for(const y of [-1,1])for(const x of [-1,1])out.push(eye.map((v,i)=>v+z*(r[i]+x*r[4+i]+y*r[8+i])));
 return out;
}
test('ShadowCasterVolumeCullingで受光体積と光源側の候補を保守的に保持する',()=>{
 for(const yaw of [0,0.7,2.5])for(const pitch of [-0.6,0,0.8])for(const elevation of [1,30,85]){
  const points=corners([120,200,-75],yaw,pitch,Math.PI/3,1,800),light=lightDirection(63,elevation),planes=buildShadowCasterVolumeCullingPlanes(points,light);
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

const { mainViewProjection, frustumPlanes, shadowMatrix } = await import('../site/content/lab/webgpu/experiments/rendering-sandbox/v02/render-math.ts');
test('メインビューの無限遠Reversed Zと遠方面のカリングが整合する', () => {
 const m = mainViewProjection([0, 0, 0], 0, 0, Math.PI / 3, 1.7);
 const planes = frustumPlanes(m);
 for (const distance of [1, 10, 1000, 1e9]) {
  const p = [0, 0, -distance, 1];
  const clip = [0,1,2,3].map(row => p.reduce((sum,v,col) => sum + v*m[col*4+row],0));
  assert.ok(Math.abs(clip[2]/clip[3] - 1/distance) < 1e-8);
  for(let i=0;i<6;i++) assert.ok(p.reduce((sum,v,j)=>sum+v*planes[i*4+j],0)>=0);
 }
 assert.equal(planes[16],0);assert.equal(planes[17],0);assert.equal(planes[18],0);assert.equal(planes[19],1);
 const p=[0,0,-0.5,1];
 assert.ok(p.reduce((sum,v,j)=>sum+v*planes[20+j],0)<0);
});
test('シャドウ正射影も光源側が1、遠方側が0のReversed Zである', () => {
 const light=lightDirection(60,30),range=500;
 const m=shadowMatrix([0,0,0],light,100,range,1024);
 for(const sign of [-1,1]) {
  const p=light.map(v=>v*range*sign);
  const z=m[2]*p[0]+m[6]*p[1]+m[10]*p[2]+m[14];
  assert.ok(Math.abs(z-(sign+1)/2)<1e-6);
 }
});

// 体積構築とは独立に、点から光と逆向きへ伸ばした半直線と受光フラスタムの交差を解く。
test('6面12辺の直接構築が半直線と受光フラスタムの交差判定に一致する', () => {
 let seed=12345;
 const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
 for(const yaw of [0,0.8])for(const pitch of [-0.3,0.4])for(const elevation of [0,30,90]) {
  const eye=[120,200,-75],near=1,far=800,fov=Math.PI/3;
  const light=lightDirection(60,elevation),rays=skyRayFrame(yaw,pitch,1.7,fov),forward=[...rays.slice(0,3)];
  const f=[...frustumPlanes(mainViewProjection(eye,yaw,pitch,fov,1.7)).slice(0,16),
   ...forward,-dot(forward,eye)-near,...forward.map(v=>-v),dot(forward,eye)+far];
  const volume=buildShadowCasterVolumeCullingPlanes(corners(eye,yaw,pitch,fov,near,far),light);
  for(let sample=0;sample<1000;sample++) {
   const p=[0,1,2].map(()=>random()*4000-2000);
   let lo=0,hi=Infinity;
   for(let i=0;i<24;i+=4) {
    const n=f.slice(i,i+3),a=dot(n,light),value=dot(n,p)+f[i+3];
    if(Math.abs(a)<1e-10){if(value<0){hi=-1;break;}}
    else if(a>0){hi=Math.min(hi,value/a);}else{lo=Math.max(lo,value/a);}
   }
   let inside=true;
   for(let i=0;i<volume.length;i+=4)if(dot([...volume.slice(i,i+3)],p)+volume[i+3]<0){inside=false;break;}
   assert.equal(inside,lo<=hi);
  }
 }
});
