import type { BranchElement, LeafClass, LeafElement, LibraryParameters, Vec3 } from './leaf-library.js';

export interface BranchClassSpec {
    name: string;
    triangles: number;
    segments: number;
    leaves: number;
    extent: number;
}
export const BRANCH_CLASSES: readonly BranchClassSpec[] = [
    { name: '小：32tri', triangles: 32, segments: 2, leaves: 10, extent: 0.7 },
    { name: '中：64tri', triangles: 64, segments: 4, leaves: 20, extent: 0.85 },
    { name: '大：128tri', triangles: 128, segments: 4, leaves: 52, extent: 1 }
];
export const BRANCH_PRESETS = [
    { name: '広葉樹・扇状', type: 'broadleaf', width: 1.2, depth: 0.8, rise: 0.9, length: 0.85, leafWidth: 0.44, color: [0.065,0.23,0.045] },
    { name: '広葉樹・丸い塊', type: 'broadleaf', width: 0.85, depth: 1.1, rise: 1.3, length: 0.9, leafWidth: 0.48, color: [0.095,0.29,0.045] },
    { name: '広葉樹・垂れ枝', type: 'broadleaf', width: 1.15, depth: 0.9, rise: 0.4, length: 0.95, leafWidth: 0.4, color: [0.05,0.2,0.075] },
    { name: '松風・枝葉', type: 'pine', width: 0.9, depth: 0.8, rise: 1.1, length: 1.1, leafWidth: 0.075, color: [0.035,0.15,0.055] }
] as const;

const add = (a: Vec3, b: Vec3): Vec3 => [a[0]+b[0],a[1]+b[1],a[2]+b[2]];
const scale = (a: Vec3, s: number): Vec3 => [a[0]*s,a[1]*s,a[2]*s];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const unit = (a: Vec3): Vec3 => scale(a,1/Math.hypot(...a));

export function createBranchCluster(spec: BranchClassSpec, parameters: LibraryParameters): LeafClass {
    const vertices: number[] = [], indices: number[] = [];
    const branchVertices = spec.segments*6;
    // 三角断面の側面のみ。端面なしで1区間6三角形を維持する。
    for (let segment=0; segment<spec.segments; segment++) {
        const base=segment*6;
        for (let i=0; i<3; i++) {
            const j=(i+1)%3;
            indices.push(base+i,base+j,base+3+i,base+j,base+3+j,base+3+i);
        }
    }
    for (let leaf=0; leaf<spec.leaves; leaf++) {
        const at=branchVertices+leaf*4;
        indices.push(at,at+1,at+2,at,at+2,at+3);
    }
    const variations = BRANCH_PRESETS.map((preset, variation) => {
        let state=parameters.seed;
        const random=(): number => {
            state=(Math.imul(state,1664525)+1013904223)>>>0;
            return state/4294967296;
        };
        const branches: BranchElement[]=[];
        const hasStem=spec.segments>2;
        const limbCount=hasStem?spec.segments-1:spec.segments;
        if (hasStem) branches.push({start:[0,0,0],end:[0.04,0.6*spec.extent,0],radius0:0.065,radius1:0.036});
        for (let limb=0; limb<limbCount; limb++) {
            // 扇状と丸い塊で奥行き配置を変え、分岐位置と高さもずらして対称な三叉を避ける。
            const angle=(limb/limbCount)*Math.PI*2+0.3;
            const azimuth=preset.name==='広葉樹・丸い塊'?angle:[-2.65,-0.15,1.25][limb];
            const start: Vec3=hasStem?[0.04*(0.4+limb*0.25),(0.23+limb*0.16)*spec.extent,0]:[0,0,0];
            const reach=spec.extent*preset.width*parameters.spread*(0.95+random()*0.1);
            const end: Vec3=[Math.cos(azimuth)*reach,
                (preset.rise+0.3*Math.sin(angle))*spec.extent,
                Math.sin(azimuth)*reach*preset.depth*parameters.depth];
            branches.push({start,end,radius0:0.035*spec.extent,radius1:0.008*spec.extent});
        }
        for (const branch of branches) {
            const delta=add(branch.end,scale(branch.start,-1)), length=Math.hypot(...delta), axis=unit(delta);
            const u=unit(cross(Math.abs(axis[1])<0.9?[0,1,0]:[1,0,0],axis)), v=cross(axis,u);
            for (let ring=0; ring<2; ring++) {
                for (let i=0; i<3; i++) {
                    const angle=i*Math.PI*2/3;
                    const radial=add(scale(u,Math.cos(angle)),scale(v,Math.sin(angle)));
                    const center=ring===0?branch.start:branch.end, radius=ring===0?branch.radius0:branch.radius1;
                    const normal=unit(add(radial,scale(axis,(branch.radius0-branch.radius1)/length)));
                    vertices.push(...add(center,scale(radial,radius)),...normal,0.11,0.055,0.023);
                }
            }
        }
        const leaves: LeafElement[]=[];
        for (let i=0; i<spec.leaves; i++) {
            const group=i%limbCount, slot=Math.floor(i/limbCount);
            const count=Math.ceil((spec.leaves-group)/limbCount);
            const t=(slot+0.5)/count;
            const branchIndex=group+(hasStem?1:0), branch=branches[branchIndex];
            const delta=add(branch.end,scale(branch.start,-1)), axis=unit(delta);
            const sideAxis=unit(cross(axis,Math.abs(axis[1])<0.95?[0,1,0]:[0,0,1]));
            const upAxis=cross(sideAxis,axis);
            const phase=slot*2.399963+group*0.7+(random()-0.5)*0.3;
            const outward=add(scale(sideAxis,Math.cos(phase)),scale(upAxis,Math.sin(phase)));
            // 枝先だけに集中させず、枝の途中から交互に葉を伸ばす。小枝自体が葉の付け根になる。
            const at=0.18+0.82*t;
            const base=add(branch.start,scale(delta,at));
            const forward=preset.type==='pine'?0.9:0.35;
            const lift=preset.name==='広葉樹・垂れ枝'?-0.3:0.2;
            const direction=unit(add(scale(axis,forward),add(scale(outward,0.8*parameters.opening),[0,lift,0])));
            const taper=0.75+0.25*Math.sin(Math.PI*t);
            const length=preset.length*parameters.leafSize*(0.85+random()*0.3)*taper;
            const width=preset.leafWidth*parameters.leafSize*(0.85+random()*0.3)*taper;
            const reference: Vec3=[0.35*Math.cos(phase),0.8,0.35*Math.sin(phase)];
            // 長軸に直交する基底を作り、葉ごとにロールを付けて一方向から面が消える偏りを減らす。
            const fallback=Math.abs(direction[1])<0.9?[0,1,0]:[0,0,1];
            const raw=cross(direction,reference);
            const u0=unit(Math.hypot(...raw)>1e-5?raw:cross(direction,[fallback[0],fallback[1],fallback[2]]));
            const n0=cross(u0,direction);
            const roll=(random()-0.5)*1.5+(slot%3-1)*0.25;
            const u=add(scale(u0,Math.cos(roll)),scale(n0,Math.sin(roll)));
            const normal=cross(u,direction), center=add(base,scale(direction,length/2));
            const shade=0.75+random()*0.25;
            const debug: Vec3[]=[[0.45,0.065,0.03],[0.045,0.33,0.09],[0.045,0.15,0.5],[0.45,0.26,0.025]];
            const source=parameters.debugColors?debug[variation]:preset.color;
            const color: Vec3=[source[0]*shade,source[1]*shade,source[2]*shade];
            leaves.push({center,widthAxis:u,lengthAxis:direction,halfWidth:width/2,halfLength:length/2,color,branchIndex});
            for (const [x,y] of [[width/2,0],[0,length/2],[-width/2,0],[0,-length/2]]) {
                vertices.push(...add(center,add(scale(u,x),scale(direction,y))),...normal,...color);
            }
        }
        return {preset,seed:parameters.seed,parameters:{...parameters},leaves,branches};
    });
    return {name:spec.name,verticesPerVariation:branchVertices+spec.leaves*4,variationCount:variations.length,variations,
        triangles:spec.triangles,leafCount:spec.leaves,branchCount:spec.segments,
        vertices:new Float32Array(vertices),indices:new Uint16Array(indices)};
}
