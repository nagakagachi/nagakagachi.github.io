import { BRANCH_CLASSES, createBranchCluster } from './branch-cluster.js';
import type { BranchClassSpec } from './branch-cluster.js';
export { BRANCH_CLASSES, BRANCH_PRESETS } from './branch-cluster.js';

export type Vec3 = [number, number, number];
export interface LeafElement {
    center: Vec3;
    widthAxis: Vec3;
    lengthAxis: Vec3;
    halfWidth: number;
    halfLength: number;
    color: Vec3;
    branchIndex: number;
}
export interface BranchPreset {
    readonly name: string;
    readonly type: 'broadleaf' | 'pine';
    readonly width: number;
    readonly depth: number;
    readonly rise: number;
    readonly length: number;
    readonly leafWidth: number;
    readonly color: readonly [number,number,number];
}
export interface LibraryParameters {
    seed: number;
    spread: number;
    opening: number;
    depth: number;
    leafSize: number;
    debugColors: boolean;
}
export const DEFAULT_LIBRARY_PARAMETERS: Readonly<LibraryParameters> = {
    seed:1234,spread:1,opening:1,depth:1,leafSize:1,debugColors:false
};
export interface BranchElement { start: Vec3; end: Vec3; radius0: number; radius1: number }
export interface LeafClass {
    name: string;
    verticesPerVariation: number;
    variationCount: number;
    triangles: number;
    leafCount: number;
    branchCount: number;
    variations: { preset: BranchPreset; seed: number; parameters: LibraryParameters; leaves: LeafElement[]; branches: BranchElement[] }[];
    vertices: Float32Array<ArrayBuffer>;
    indices: Uint16Array<ArrayBuffer>;
}
export interface MeshGeometry {
    verticesPerVariation: number;
    variationCount: number;
    vertices: Float32Array<ArrayBuffer>;
    indices: Uint16Array<ArrayBuffer>;
}
export interface LeafScene {
    wood?: { geometry: MeshGeometry; placements: Float32Array<ArrayBuffer> };

    placements: Float32Array<ArrayBuffer>[];
    debugLines?: Float32Array<ArrayBuffer>;
    markerVertices: Float32Array<ArrayBuffer>;
    markerIndices: Uint16Array<ArrayBuffer>;
    bounds: { min: Vec3; max: Vec3 };
}
export interface SceneParameters { markerHeight: number; leafScale: number; classIndex?: number; variationIndex?: number }
export const DEFAULT_PARAMETERS: Readonly<SceneParameters> = { markerHeight:0.75,leafScale:1 };

export function createLeafLibrary(parameters: LibraryParameters = DEFAULT_LIBRARY_PARAMETERS): LeafClass[] {
    if (!Number.isInteger(parameters.seed) || parameters.seed<0 || parameters.seed>0xffffffff) throw new Error('シードはuint32の整数にしてください');
    for (const value of [parameters.spread,parameters.opening,parameters.depth,parameters.leafSize]) {
        if (!Number.isFinite(value) || value<0.5 || value>1.5) throw new Error('枝葉の生成倍率が範囲外です');
    }
    return BRANCH_CLASSES.map((spec: BranchClassSpec)=>createBranchCluster(spec,parameters));
}

export function createLeafScene(library: readonly LeafClass[], parameters: SceneParameters): LeafScene {
    const { markerHeight, leafScale } = parameters;
    const classIndex = parameters.classIndex ?? -1;
    if (!Number.isInteger(classIndex) || classIndex < -1 || classIndex >= library.length) throw new Error('表示クラスが範囲外です');
    if (!Number.isFinite(markerHeight) || markerHeight < 0.5 || markerHeight > 3
        || !Number.isFinite(leafScale) || leafScale < 0.5 || leafScale > 2) throw new Error('配置パラメータが範囲外です');
    const variationIndex=parameters.variationIndex ?? -1;
    if (!Number.isInteger(variationIndex) || variationIndex < -1 || variationIndex > 3) throw new Error('バリエーションが範囲外です');
    const min: Vec3 = [Infinity, 0, Infinity], max: Vec3 = [-Infinity, -Infinity, -Infinity];
    const markerVertices: number[] = [], markerIndices: number[] = [];
    const include = (p: Vec3): void => {
        for (let i = 0; i < 3; i++) { min[i] = Math.min(min[i], p[i]); max[i] = Math.max(max[i], p[i]); }
    };
    const placements = library.map((leaf, classId) => {
        if (classIndex >= 0 && classId !== classIndex) return new Float32Array(0);
        const ids = variationIndex<0?Array.from({length:leaf.variationCount},(_,i)=>i):[variationIndex];
        // 1配置=48byte。位置とスケール、単位Quaternion、uint32のバリエーションID。
        const buffer = new ArrayBuffer(ids.length * 48), floats = new Float32Array(buffer), words = new Uint32Array(buffer);
        for (let instance = 0; instance < ids.length; instance++) {
            const variation = ids[instance];
            const x = (instance-(ids.length-1)/2)*4.2;
            const z = classIndex >= 0 ? 0 : (classId-1)*-5;
            floats.set([x, markerHeight, z, leafScale], instance * 12);
            floats.set([0,0,0,1],instance*12+4);
            words[instance * 12 + 8] = variation;
            for (let v = 0; v < leaf.verticesPerVariation; v++) {
                const at = (variation * leaf.verticesPerVariation + v) * 9;
                include([x + leaf.vertices[at]*leafScale, markerHeight + leaf.vertices[at+1]*leafScale, z + leaf.vertices[at+2]*leafScale]);
            }
            // 共通の目印は塊の根元を示すだけで、比較するモデルのPrim予算には含めない。
            const corners: Vec3[] = [[-0.045,0,-0.045],[0.045,0,-0.045],[0.045,markerHeight,-0.045],[-0.045,markerHeight,-0.045],
                [-0.045,0,0.045],[0.045,0,0.045],[0.045,markerHeight,0.045],[-0.045,markerHeight,0.045]];
            const faces = [[0,3,2,1],[4,5,6,7],[0,4,7,3],[1,2,6,5],[3,7,6,2],[0,1,5,4]];
            const normals: Vec3[] = [[0,0,-1],[0,0,1],[-1,0,0],[1,0,0],[0,1,0],[0,-1,0]];
            faces.forEach((face, f) => {
                const base = markerVertices.length / 9;
                for (const c of face) {
                    const p: Vec3 = [x+corners[c][0], corners[c][1], z+corners[c][2]];
                    include(p); markerVertices.push(...p, ...normals[f], 0.17, 0.09, 0.04);
                }
                markerIndices.push(base,base+1,base+2,base,base+2,base+3);
            });
        }
        return floats;
    });
    return { placements, markerVertices: new Float32Array(markerVertices), markerIndices: new Uint16Array(markerIndices), bounds: { min, max } };
}
