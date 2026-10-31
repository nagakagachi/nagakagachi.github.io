import type { MeshGeometry, Vec3 } from './leaf-library.js';
import type { TreeModel } from './tree-model.js';

export const WOOD_LODS = [
    { sides:8, trunkSegments:12, branchSegments:8 },
    { sides:6, trunkSegments:6, branchSegments:4 },
    { sides:4, trunkSegments:3, branchSegments:2 }
] as const;
export interface WoodParameters { radiusRatio: number; taper: number }
export const DEFAULT_WOOD_PARAMETERS: Readonly<WoodParameters> = {radiusRatio:0.025,taper:1};
const dot=(a:Vec3,b:Vec3):number=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
const cross=(a:Vec3,b:Vec3):Vec3=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const unit=(a:Vec3):Vec3=>{const n=Math.hypot(...a);if(n<1e-10)throw new Error('骨格の線分長が不足しています');return [a[0]/n,a[1]/n,a[2]/n];};
function sample(points:readonly Vec3[],t:number):Vec3 {
    const at=t*(points.length-1),i=Math.min(points.length-2,Math.floor(at)),f=at-i;
    const a=points[i],b=points[i+1];
    return [a[0]+(b[0]-a[0])*f,a[1]+(b[1]-a[1])*f,a[2]+(b[2]-a[2])*f];
}
export function createWoodGeometry(trees:readonly TreeModel[],height:number,p:Readonly<WoodParameters>,lod:number):MeshGeometry {
    const spec=WOOD_LODS[lod];
    if(!spec||!trees.length||!Number.isFinite(height)||height<=0
        ||!Number.isFinite(p.radiusRatio)||p.radiusRatio<0.01||p.radiusRatio>0.08
        ||!Number.isFinite(p.taper)||p.taper<0.5||p.taper>2)throw new Error('幹メッシュの設定が範囲外です');
    const branchCount=trees[0].branches.length;
    if(trees.some(tree=>tree.branches.length!==branchCount))throw new Error('共有IBの骨格枝数が一致しません');
    const indices:number[]=[],allVertices:number[]=[];
    let verticesPerVariation=0;
    for(const [variation,tree] of trees.entries()) {
        const vertices:number[]=[];
        for(const [branchId,branch] of tree.branches.entries()) {
            const segments=branchId===0?spec.trunkSegments:spec.branchSegments;
            const centers=Array.from({length:segments+1},(_,i)=>sample(branch.points,i/segments));
            const base=vertices.length/9;
            const parent=branch.parentId===null?undefined:tree.branches[branch.parentId];
            const birth=parent?(branch.parentSegment+branch.parentFraction)/(parent.points.length-1):0;
            const rootRadius=height*p.radiusRatio*(branchId===0?1:0.6*Math.max(0.15,(1-birth)**p.taper));
            let previousTangent:Vec3=[0,1,0],normal:Vec3=[1,0,0];
            for(let ring=0;ring<=segments;ring++) {
                const a=centers[Math.max(0,ring-1)],b=centers[Math.min(segments,ring+1)];
                const tangent=unit([b[0]-a[0],b[1]-a[1],b[2]-a[2]]);
                // 最短回転で断面フレームを運ぶ。初期接線の反転時も安定した軸を選ぶ。
                const axis=cross(previousTangent,tangent),cos=dot(previousTangent,tangent);
                if(cos> -0.9999) {
                    const v=cross(axis,normal),w=cross(axis,v);
                    normal=unit([normal[0]+v[0]+w[0]/(1+cos),normal[1]+v[1]+w[1]/(1+cos),normal[2]+v[2]+w[2]/(1+cos)]);
                } else {
                    const reference:Vec3=Math.abs(tangent[0])<0.8?[1,0,0]:[0,0,1];
                    normal=unit(cross(tangent,reference));
                }
                previousTangent=tangent;
                const binormal=cross(tangent,normal),t=ring/segments;
                const radius=rootRadius*(0.08+0.92*(1-t)**p.taper);
                // テーパーの法線補正は、このリング前後の半径差と中心線の距離から求める。
                const radiusAt=(ring:number):number=>rootRadius*(0.08+0.92*(1-ring/segments)**p.taper);
                const slope=(radiusAt(Math.min(segments,ring+1))-radiusAt(Math.max(0,ring-1)))
                    /Math.max(0.001,Math.hypot(b[0]-a[0],b[1]-a[1],b[2]-a[2]));
                for(let side=0;side<spec.sides;side++) {
                    const angle=side/spec.sides*Math.PI*2,c=Math.cos(angle),s=Math.sin(angle);
                    const radial:Vec3=[normal[0]*c+binormal[0]*s,normal[1]*c+binormal[1]*s,normal[2]*c+binormal[2]*s];
                    const n=unit([radial[0]-tangent[0]*slope,radial[1]-tangent[1]*slope,radial[2]-tangent[2]*slope]);
                    vertices.push(centers[ring][0]+radial[0]*radius,centers[ring][1]+radial[1]*radius,centers[ring][2]+radial[2]*radius,
                        ...n,0.19,0.095,0.038);
                }
            }
            if(variation===0)for(let ring=0;ring<segments;ring++)for(let side=0;side<spec.sides;side++) {
                const a=base+ring*spec.sides+side,b=base+ring*spec.sides+(side+1)%spec.sides;
                indices.push(a,b,a+spec.sides,b,b+spec.sides,a+spec.sides);
            }
            // 端面は独立法線。枝の根元は主幹内部へ埋まり、接合の溶接は行わない。
            for(const end of [0,segments]) {
                const at=vertices.length/9,center=centers[end],neighbor=centers[end===0?1:segments-1];
                const capNormal=unit([center[0]-neighbor[0],center[1]-neighbor[1],center[2]-neighbor[2]]);
                vertices.push(...center,...capNormal,0.19,0.095,0.038);
                for(let side=0;side<spec.sides;side++) {
                    const source=(base+end*spec.sides+side)*9;
                    vertices.push(...vertices.slice(source,source+3),...capNormal,0.19,0.095,0.038);
                }
                if(variation===0)for(let side=0;side<spec.sides;side++) {
                    const a=at+1+side,b=at+1+(side+1)%spec.sides;
                    indices.push(at,...(end===0?[b,a]:[a,b]));
                }
            }
        }
        if(variation===0)verticesPerVariation=vertices.length/9;
        if(vertices.length/9!==verticesPerVariation||verticesPerVariation>65535)throw new Error('幹の共有トポロジが不正です');
        allVertices.push(...vertices);
    }
    return {verticesPerVariation,variationCount:trees.length,vertices:new Float32Array(allVertices),indices:new Uint16Array(indices)};
}
