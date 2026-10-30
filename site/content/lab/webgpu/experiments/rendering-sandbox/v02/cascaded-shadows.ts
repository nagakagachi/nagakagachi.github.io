import { shadowMatrix, skyRayFrame, dot } from './render-math.js';
import type { Vec3 } from './render-math.js';
export const CASCADES = 4;
export const CASCADE_SIZE = 1024;
export const ATLAS_SIZE = 2048;
export interface Cascade { matrix: Float32Array<ArrayBuffer>; shadowCasterVolumePlanes: Float32Array<ArrayBuffer>; split: number; }
const add = (a: Vec3, b: Vec3): Vec3 => [a[0]+b[0],a[1]+b[1],a[2]+b[2]];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0]-b[0],a[1]-b[1],a[2]-b[2]];
const mul = (a: Vec3, s: number): Vec3 => [a[0]*s,a[1]*s,a[2]*s];
const cross = (a: Vec3,b: Vec3): Vec3 => [a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
// 頂点順はnear/far × 下/上 × 左/右。各面の3頂点と、各辺に接する2面を固定表で参照する。
const FRUSTUM_FACES = [[0,2,6], [1,5,7], [0,4,5], [2,3,7], [0,1,3], [4,6,7]] as const;
const FRUSTUM_EDGES = [
    [0,1,2,4], [1,3,1,4], [3,2,3,4], [2,0,0,4],
    [4,5,2,5], [5,7,1,5], [7,6,3,5], [6,4,0,5],
    [0,4,0,2], [1,5,1,2], [2,6,0,3], [3,7,1,3],
] as const;

// 分割したメインビューフラスタムの6面・12辺からShadow Caster Volumeを直接構築する。
// 28頂点ペア・56三角組の列挙、支持平面の全頂点判定、重複平面の探索は行わない。
export function buildShadowCasterVolumeCullingPlanes(corners: Vec3[], light: Vec3): Float32Array<ArrayBuffer> {
    const center = mul(corners.reduce((sum, point) => add(sum, point), [0,0,0] as Vec3), 1/8);
    const faces = FRUSTUM_FACES.map(([a,b,c]) => {
        const raw = cross(sub(corners[b], corners[a]), sub(corners[c], corners[a]));
        let n = mul(raw, 1/Math.hypot(...raw));
        if (dot(n, sub(center, corners[a])) < 0) { n = mul(n, -1); }
        return { n, d: -dot(n, corners[a]), keep: dot(n, light) >= 0 };
    });
    const planes: number[] = [];
    for (const face of faces) {
        if (face.keep) { planes.push(...face.n, face.d); }
    }
    // 残す面と除去する面の共有辺だけがシルエット辺になる。
    for (const [a,b,first,second] of FRUSTUM_EDGES) {
        if (faces[first].keep === faces[second].keep) { continue; }
        const raw = cross(sub(corners[b], corners[a]), light);
        const length = Math.hypot(...raw);
        if (length < 1e-8) { continue; }
        let n = mul(raw, 1/length);
        if (dot(n, sub(center, corners[a])) < 0) { n = mul(n, -1); }
        planes.push(...n, -dot(n, corners[a]));
    }
    if (planes.length > 16*4) { throw new Error('ShadowCasterVolumeCullingの平面数が上限を超えました'); }
    return new Float32Array(planes);
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
            shadowCasterVolumePlanes:buildShadowCasterVolumeCullingPlanes(corners,light),split:far};
    });
}
