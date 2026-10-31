import type { Vec3 } from './leaf-library.js';

export type Quaternion = [number, number, number, number];
export const PLACEMENT_FLOATS = 12;
export const PLACEMENT_BYTES = 48;
export interface Placement {
    position: Vec3;
    rotation: Quaternion;
    scale: number;
    variationId: number;
}

export function rotateVector(v: Vec3, q: Quaternion): Vec3 {
    const cross: Vec3 = [q[1]*v[2]-q[2]*v[1],q[2]*v[0]-q[0]*v[2],q[0]*v[1]-q[1]*v[0]];
    return [
        v[0]+2*(q[3]*cross[0]+q[1]*cross[2]-q[2]*cross[1]),
        v[1]+2*(q[3]*cross[1]+q[2]*cross[0]-q[0]*cross[2]),
        v[2]+2*(q[3]*cross[2]+q[0]*cross[1]-q[1]*cross[0])
    ];
}
export function transformPoint(v: Vec3, placement: Placement): Vec3 {
    const rotated=rotateVector(v,placement.rotation);
    return [rotated[0]*placement.scale+placement.position[0],rotated[1]*placement.scale+placement.position[1],rotated[2]*placement.scale+placement.position[2]];
}
export function packPlacements(placements: readonly Placement[]): Float32Array<ArrayBuffer> {
    const buffer=new ArrayBuffer(placements.length*PLACEMENT_BYTES);
    const floats=new Float32Array(buffer), words=new Uint32Array(buffer);
    placements.forEach((p,i)=>{
        const at=i*PLACEMENT_FLOATS;
        floats.set([...p.position,p.scale,...p.rotation],at);
        words[at+8]=p.variationId;
    });
    return floats;
}
