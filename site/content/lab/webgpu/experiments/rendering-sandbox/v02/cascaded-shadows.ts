import { shadowMatrix, skyRayFrame, dot } from './render-math.js';
import type { Vec3 } from './render-math.js';
export const CASCADES = 4;
export const CASCADE_SIZE = 1024;
export const ATLAS_SIZE = 2048;
export interface Cascade { matrix: Float32Array<ArrayBuffer>; planes: Float32Array<ArrayBuffer>; split: number; }
const add = (a: Vec3, b: Vec3): Vec3 => [a[0]+b[0],a[1]+b[1],a[2]+b[2]];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0]-b[0],a[1]-b[1],a[2]-b[2]];
const mul = (a: Vec3, s: number): Vec3 => [a[0]*s,a[1]*s,a[2]*s];
const cross = (a: Vec3,b: Vec3): Vec3 => [a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
// 有限受光フラスタムを光源方向へ無限押し出しする凸体。光源正射影の有限Z範囲と交差させる。
// 面のうち押出方向へ開かないものと、シルエット辺から生じる側面を残す。
export function casterPlanes(corners: Vec3[], light: Vec3): Float32Array<ArrayBuffer> {
    const planes: number[][] = [];
    function accept(raw: Vec3, point: Vec3, sideOnly = false): void {
        const length = Math.hypot(...raw); if (length < 1e-8) { return; }
        let n = mul(raw,1/length), d = -dot(n,point);
        const values = corners.map(p=>dot(n,p)+d);
        if (Math.min(...values) < -0.001) {
            if (Math.max(...values) > 0.001) { return; }
            n=mul(n,-1);d=-d;
        }
        if (!sideOnly && dot(n,light)<-1e-6) { return; }
        if (planes.some(p=>Math.abs(p[0]-n[0])+Math.abs(p[1]-n[1])+Math.abs(p[2]-n[2])<1e-5 && Math.abs(p[3]-d)<0.01)) { return; }
        planes.push([...n,d]);
    }
    for(let i=0;i<8;i++)for(let j=i+1;j<8;j++) {
        const edge=sub(corners[j],corners[i]);
        accept(cross(edge,light),corners[i],true);
        for(let k=j+1;k<8;k++) { accept(cross(edge,sub(corners[k],corners[i])),corners[i]); }
    }
    if(planes.length>16) { throw new Error('キャスター体積の平面数が上限を超えました'); }
    return new Float32Array(planes.flat());
}
export function buildCascades(eye: Vec3, yaw: number, pitch: number, fov: number, aspect: number,
    light: Vec3, distance: number, sceneExtent: number): Cascade[] {
    const rays=skyRayFrame(yaw,pitch,aspect,fov);
    const forward: Vec3=[rays[0],rays[1],rays[2]], right: Vec3=[rays[4],rays[5],rays[6]], up: Vec3=[rays[8],rays[9],rays[10]];
    const splits=Array.from({length:4},(_,i)=>{
        const t=(i+1)/4;return 0.75*Math.pow(distance,t)+0.25*(1+(distance-1)*t);
    });
    return splits.map((far,i)=>{
        // 前段の末尾10%を重ね、PSで段の切替をブレンドする。
        const near=i===0?1:(i===1?1:splits[i-2])+(splits[i-1]-(i===1?1:splits[i-2]))*0.9;
        const corners: Vec3[]=[];
        for(const z of [near,far])for(const y of [-1,1])for(const x of [-1,1]) {
            corners.push(add(eye,mul(add(forward,add(mul(right,x),mul(up,y))),z)));
        }
        const center=add(eye,mul(forward,(near+far)*0.5));
        // 球で囲う投影はカメラ回転で大きさが変わらず、テクセルスナップと併用して安定化する。
        let radius=Math.hypot(far*Math.tan(fov/2)*aspect,far*Math.tan(fov/2),(far-near)*0.5);
        radius=Math.ceil(radius*16)/16;
        radius*=CASCADE_SIZE/(CASCADE_SIZE-8);
        return {matrix:shadowMatrix(center,light,radius,sceneExtent+Math.abs(dot(light,sub(center,[eye[0],0,eye[2]])))+16,CASCADE_SIZE),
            planes:casterPlanes(corners,light),split:far};
    });
}
