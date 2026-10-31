import type { LeafClass, LeafScene, Vec3 } from './leaf-library.js';
import { packPlacements, transformPoint } from './placements.js';
import type { Placement, Quaternion } from './placements.js';

export const TREE_FORMS = ['conical','oval','rounded','umbrella','vase','weeping'] as const;
export type TreeForm = typeof TREE_FORMS[number];
export function isTreeForm(value: string): value is TreeForm {
    return TREE_FORMS.some(form=>form===value);
}
// 角度は度、長さ・高さは樹高に対する比率。プリセット名は生成処理で参照しない。
export const SHAPE_CONTROLS = {
    trunkRatio: ['主幹の高さ比', 0.2, 1, 0.05],
    birthStart: ['主要枝の発生開始高さ', 0, 1, 0.05],
    birthEnd: ['主要枝の発生終了高さ', 0, 1, 0.05],
    birthBias: ['発生高さの偏り', 0.25, 4, 0.25],
    azimuth: ['開始方位角', -180, 180, 5],
    azimuthStep: ['方位角の間隔', 0, 180, 5],
    inclination: ['分岐角（上向きが0°）', 0, 150, 5],
    branchLength: ['主要枝の長さ比', 0.1, 1, 0.05],
    lengthFalloff: ['高い位置での短縮', 0, 0.9, 0.05],
    curvature: ['外側へ曲がる角度', -120, 120, 5],
    curveStart: ['曲がりの開始位置', 0, 0.9, 0.05],
    droop: ['先端の下垂', 0, 1, 0.05],
    irregularity: ['不規則さ', 0, 1, 0.05],
    trunkShare: ['主幹への枝葉配分', 0, 1, 0.05],
    socketStart: ['枝葉の配置開始位置', 0, 0.9, 0.05],
    socketEnd: ['枝葉の配置終了位置', 0.1, 1, 0.05],
    crownBase: ['枝葉サイズ・下部', 0.1, 1.5, 0.05],
    crownMiddle: ['枝葉サイズ・中部', 0.1, 1.5, 0.05],
    crownTop: ['枝葉サイズ・上部', 0.1, 1.5, 0.05],
    leafLift: ['枝葉の上向き補正', -1, 1, 0.05]
} as const;
export type ShapeKey = keyof typeof SHAPE_CONTROLS;
export type TreeShape = { [K in ShapeKey]: number };
const BASE_SHAPE: Readonly<TreeShape> = {
    trunkRatio:0.85,birthStart:0.35,birthEnd:0.85,birthBias:1,
    azimuth:0,azimuthStep:120,inclination:50,branchLength:0.4,lengthFalloff:0.2,
    curvature:30,curveStart:0.25,droop:0,irregularity:0.2,
    trunkShare:0.3,socketStart:0.25,socketEnd:1,
    crownBase:0.7,crownMiddle:1,crownTop:0.55,leafLift:0.3
};
export const TREE_PRESETS: Readonly<Record<TreeForm, { majorBranches: number; shape: Readonly<TreeShape> }>> = {
    conical: {majorBranches:0,shape:{...BASE_SHAPE,trunkRatio:1,socketStart:0.25,crownBase:1.3,crownMiddle:0.75,crownTop:0.1}},
    oval: {majorBranches:3,shape:{...BASE_SHAPE,trunkRatio:0.95,birthStart:0.3,birthEnd:0.75,inclination:25,branchLength:0.4,curvature:10,crownBase:0.55,crownMiddle:1,crownTop:0.4}},
    rounded: {majorBranches:3,shape:BASE_SHAPE},
    umbrella: {majorBranches:3,shape:{...BASE_SHAPE,trunkRatio:0.9,birthStart:0.8,birthEnd:0.95,inclination:85,curvature:0,branchLength:0.45,trunkShare:0.25,socketStart:0.65,crownBase:0.8,crownMiddle:1,crownTop:1,leafLift:0.5}},
    vase: {majorBranches:3,shape:{...BASE_SHAPE,trunkRatio:0.55,birthStart:0.3,birthEnd:0.65,inclination:25,branchLength:0.7,curvature:25,trunkShare:0,crownBase:0.3,crownMiddle:0.65,crownTop:1}},
    weeping: {majorBranches:3,shape:{...BASE_SHAPE,trunkRatio:0.85,birthStart:0.65,birthEnd:0.9,inclination:45,branchLength:0.55,curvature:100,curveStart:0.1,droop:0.35,trunkShare:0.15,crownBase:0.7,crownMiddle:1,crownTop:0.7,leafLift:-0.6}}
};
export interface TreeParameters {
    seed: number;
    height: number;
    crownWidth: number;
    socketCount: number;
    bend: number;
    classIndex: number;
    variationIndex: number;
    showTrunk: boolean;
    form: TreeForm;
    majorBranches: number;
    shape: Readonly<TreeShape>;
}
export const DEFAULT_TREE_PARAMETERS: Readonly<TreeParameters> = {
    seed:1234,height:8,crownWidth:6,socketCount:24,bend:0.8,classIndex:2,variationIndex:1,
    showTrunk:true,form:'rounded',majorBranches:3,shape:TREE_PRESETS.rounded.shape
};
export interface SkeletonBranch {
    parentId: number | null;
    parentSegment: number;
    parentFraction: number;
    points: Vec3[];
}
export interface TreeSocket {
    classIndex: number;
    branchId: number;
    segment: number;
    fraction: number;
    placement: Placement;
}
export interface TreeModel {
    centerline: Vec3[];
    branches: SkeletonBranch[];
    sockets: TreeSocket[];
}
function unit(v: Vec3): Vec3 {
    const n=Math.hypot(...v);
    return [v[0]/n,v[1]/n,v[2]/n];
}
function sample(points: readonly Vec3[], t: number) {
    const at=Math.max(0,Math.min(1,t))*(points.length-1);
    const segment=Math.min(points.length-2,Math.floor(at)), fraction=at-segment;
    const a=points[segment],b=points[segment+1];
    const position: Vec3=[a[0]+(b[0]-a[0])*fraction,a[1]+(b[1]-a[1])*fraction,a[2]+(b[2]-a[2])*fraction];
    return {segment,fraction,position,tangent:unit([b[0]-a[0],b[1]-a[1],b[2]-a[2]])};
}
function rotation(direction: Vec3): Quaternion {
    const v=unit(direction),w=1+v[1];
    // +Yからの最短回転。しだれ方向が真下の場合も有限値で扱う。
    if(w<1e-6) return [1,0,0,0];
    const n=Math.hypot(v[2],v[0],w);
    return [v[2]/n,0,-v[0]/n,w/n];
}
function makeSkeleton(p: TreeParameters, random: ()=>number): SkeletonBranch[] {
    const count=p.majorBranches, shape=p.shape;
    const trunkHeight=p.height*shape.trunkRatio;
    const points: Vec3[]=[];
    for(let i=0;i<=12;i++) {
        const t=i/12;
        points.push([p.bend*Math.sin(t*Math.PI*0.8)*t,trunkHeight*t,p.bend*0.45*(Math.cos(t*Math.PI*1.2)-1)*t]);
    }
    const branches: SkeletonBranch[]=[{parentId:null,parentSegment:0,parentFraction:0,points}];
    const radians=Math.PI/180;
    for(let i=0;i<count;i++) {
        // 高さ区間をべき乗で再分配する。1は均等、1超は低い側、1未満は高い側へ寄せる。
        const birth=shape.birthStart+(shape.birthEnd-shape.birthStart)*Math.pow((i+0.5)/count,shape.birthBias);
        const attachment=sample(points,birth);
        const angle=(shape.azimuth+i*shape.azimuthStep+(random()-0.5)*60*shape.irregularity)*radians;
        const length=p.height*shape.branchLength*(1-shape.lengthFalloff*birth)*(1+(random()-0.5)*0.4*shape.irregularity);
        const inclination=(shape.inclination+(random()-0.5)*30*shape.irregularity)*radians;
        const branchPoints: Vec3[]=[[...attachment.position]];
        for(let j=1;j<=8;j++) {
            const u=(j-0.5)/8;
            const curve=Math.max(0,(u-shape.curveStart)/(1-shape.curveStart));
            const theta=inclination+shape.curvature*radians*curve;
            const previous=branchPoints[j-1];
            // 接線を積分する共通曲線。下垂は先端側へ強く働き、初期分岐角とは独立する。
            branchPoints.push([
                previous[0]+Math.cos(angle)*Math.sin(theta)*length/8,
                previous[1]+Math.cos(theta)*length/8-p.height*shape.droop*((j/8)**2-((j-1)/8)**2),
                previous[2]+Math.sin(angle)*Math.sin(theta)*length/8
            ]);
        }
        branches.push({parentId:0,parentSegment:attachment.segment,parentFraction:attachment.fraction,points:branchPoints});
    }
    return branches;
}
function crownProfile(shape: Readonly<TreeShape>,u: number): number {
    // 下・中・上の3点を連続補間し、樹形名による特別扱いをしない。
    const t=Math.max(0,Math.min(1,u))*2;
    return t<1?shape.crownBase+(shape.crownMiddle-shape.crownBase)*t
        :shape.crownMiddle+(shape.crownTop-shape.crownMiddle)*(t-1);
}
export function createTreeScene(library: readonly LeafClass[], p: TreeParameters): LeafScene & { tree: TreeModel } {
    if(!Number.isInteger(p.seed)||p.seed<0||p.seed>0xffffffff
        ||!Number.isFinite(p.height)||p.height<3||p.height>20
        ||!Number.isFinite(p.crownWidth)||p.crownWidth<2||p.crownWidth>10
        ||!Number.isInteger(p.socketCount)||p.socketCount<4||p.socketCount>48
        ||!Number.isFinite(p.bend)||p.bend<0||p.bend>3
        ||!Number.isInteger(p.classIndex)||p.classIndex< -1||p.classIndex>=library.length
        ||!Number.isInteger(p.variationIndex)||p.variationIndex< -1||p.variationIndex>3
        ||!isTreeForm(p.form)||!Number.isInteger(p.majorBranches)||p.majorBranches<0||p.majorBranches>3) throw new Error('樹木パラメータが範囲外です');
    for(const key of Object.keys(SHAPE_CONTROLS) as ShapeKey[]) {
        const [,min,max]=SHAPE_CONTROLS[key], value=p.shape[key];
        if(!Number.isFinite(value)||value<min||value>max) throw new Error(`樹形パラメータが範囲外です：${key}`);
    }
    if(p.shape.birthStart>p.shape.birthEnd||p.shape.socketStart>p.shape.socketEnd) throw new Error('開始位置は終了位置以下にしてください');
    let state=p.seed;
    const random=(): number=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return state/4294967296;};
    const branches=makeSkeleton(p,random),centerline=branches[0].points;
    const lists: Placement[][]=library.map(()=>[]),sockets: TreeSocket[]=[];
    const extents=library.map(c=>new Array<number>(c.variationCount).fill(0));
    const majorCount=branches.length-1;
    const coreCount=majorCount?Math.round(p.socketCount*p.shape.trunkShare):p.socketCount;
    for(let i=0;i<p.socketCount;i++) {
        // 主幹への配分と枝上の配置区間は、どのプリセットでも同じ規則を使う。
        const core=i<coreCount;
        const distributed=i-coreCount, remaining=p.socketCount-coreCount;
        const branchId=core?0:majorCount?1+distributed%majorCount:0;
        const slot=core?i:majorCount?Math.floor(distributed/majorCount):i;
        const count=core?coreCount:majorCount?Math.ceil((remaining-(branchId-1))/majorCount):p.socketCount;
        const u=(slot+0.5)/count;
        const t=p.shape.socketStart+(p.shape.socketEnd-p.shape.socketStart)*u;
        const attachment=sample(branches[branchId].points,t);
        const heightFraction=attachment.position[1]/p.height;
        const classIndex=p.classIndex<0?Math.max(0,Math.min(2,Math.floor((1-heightFraction)*4))):p.classIndex;
        const variationId=p.variationIndex<0?Math.floor(random()*library[classIndex].variationCount):p.variationIndex;
        let extent=extents[classIndex][variationId];
        if(extent===0) {
            const c=library[classIndex];
            for(let v=0;v<c.verticesPerVariation;v++) {
                const at=(variationId*c.verticesPerVariation+v)*9;
                extent=Math.max(extent,Math.hypot(c.vertices[at],c.vertices[at+1],c.vertices[at+2]));
            }
            extents[classIndex][variationId]=extent;
        }
        const azimuth=i*2.399963+(random()-0.5)*0.2;
        const tangent=attachment.tangent;
        const radial: Vec3=[Math.cos(azimuth),0,Math.sin(azimuth)];
        const radialWeight=branchId===0?1:0.4;
        const direction: Vec3=[
            tangent[0]*0.8+radial[0]*radialWeight,
            tangent[1]*0.8+p.shape.leafLift,
            tangent[2]*0.8+radial[2]*radialWeight
        ];
        const envelope=crownProfile(p.shape,u);
        // 骨格の張り出しと部品サイズを分離し、取り付け点を骨格上に保つ。
        const radius=p.crownWidth*0.3*envelope*(1+(random()-0.5)*0.3*p.shape.irregularity);
        const placement: Placement={position:attachment.position,rotation:rotation(direction),scale:radius/Math.max(extent,0.01),variationId};
        lists[classIndex].push(placement);
        sockets.push({classIndex,branchId,segment:attachment.segment,fraction:attachment.fraction,placement});
    }
    const min: Vec3=[0,0,0],max: Vec3=[0,0,0];
    const include=(v: Vec3): void=>{for(let i=0;i<3;i++){min[i]=Math.min(min[i],v[i]);max[i]=Math.max(max[i],v[i]);}};
    for(const branch of branches) branch.points.forEach(include);
    lists.forEach((placements,c)=>placements.forEach(placement=>{
        for(let i=0;i<library[c].verticesPerVariation;i++) {
            const at=(placement.variationId*library[c].verticesPerVariation+i)*9;
            include(transformPoint([library[c].vertices[at],library[c].vertices[at+1],library[c].vertices[at+2]],placement));
        }
    }));
    const lines: number[]=[];
    if(p.showTrunk) for(const branch of branches) for(let i=0;i<branch.points.length-1;i++) lines.push(...branch.points[i],...branch.points[i+1]);
    return {placements:lists.map(packPlacements),markerVertices:new Float32Array(0),markerIndices:new Uint16Array(0),
        debugLines:new Float32Array(lines),bounds:{min,max},tree:{centerline,branches,sockets}};
}
