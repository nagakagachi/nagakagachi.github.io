import type {LeafClass,LeafElement,Vec3,LeafScene,SceneParameters} from './leaf-library.js';
import {createLeafScene} from './leaf-library.js';
export const LEAF_LOD_BUDGETS=[
    [{branches:2,leaves:10},{branches:1,leaves:5},{branches:0,leaves:3},{branches:0,leaves:2}],
    [{branches:4,leaves:20},{branches:2,leaves:10},{branches:1,leaves:5},{branches:0,leaves:3}],
    [{branches:4,leaves:52},{branches:2,leaves:26},{branches:1,leaves:13},{branches:0,leaves:6}]
] as const;
const add=(a:Vec3,b:Vec3):Vec3=>[a[0]+b[0],a[1]+b[1],a[2]+b[2]];
const scale=(a:Vec3,s:number):Vec3=>[a[0]*s,a[1]*s,a[2]*s];
const sub=(a:Vec3,b:Vec3):Vec3=>add(a,scale(b,-1));
const dot=(a:Vec3,b:Vec3):number=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
const cross=(a:Vec3,b:Vec3):Vec3=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const unit=(a:Vec3):Vec3=>scale(a,1/Math.hypot(...a));
export function leafCorners(leaf:LeafElement):Vec3[]{
    return [add(leaf.center,scale(leaf.widthAxis,leaf.halfWidth)),add(leaf.center,scale(leaf.lengthAxis,leaf.halfLength)),
        add(leaf.center,scale(leaf.widthAxis,-leaf.halfWidth)),add(leaf.center,scale(leaf.lengthAxis,-leaf.halfLength))];
}
function reduceLeaves(source:readonly LeafElement[],count:number,lod:number):LeafElement[]{
    const corners=source.map(leafCorners);
    const min:Vec3=[Infinity,Infinity,Infinity],max:Vec3=[-Infinity,-Infinity,-Infinity];
    corners.flat().forEach(p=>{for(let j=0;j<3;j++){min[j]=Math.min(min[j],p[j]);max[j]=Math.max(max[j],p[j]);}});
    const size:Vec3=[Math.max(0.01,max[0]-min[0]),Math.max(0.01,max[1]-min[1]),Math.max(0.01,max[2]-min[2])];
    const normals=source.map(leaf=>cross(leaf.widthAxis,leaf.lengthAxis));
    const distance=(i:number,j:number):number=>{
        const d=sub(source[i].center,source[j].center);
        return d.reduce((sum,v,k)=>sum+(v/size[k])**2,0)+0.12*(1-Math.abs(dot(normals[i],normals[j])));
    };
    // 同じLOD0から同じ順序で代表を選ぶため、LODをまたいでも代表葉の集合は入れ子になる。
    const selected:number[]=[];
    let largest=0;source.forEach((leaf,i)=>{if(leaf.halfWidth*leaf.halfLength>source[largest].halfWidth*source[largest].halfLength)largest=i;});
    selected.push(largest);
    while(selected.length<count){
        let best=-1,bestScore=-1;
        for(let i=0;i<source.length;i++)if(!selected.includes(i)){
            const score=Math.min(...selected.map(j=>distance(i,j)));
            if(score>bestScore){best=i;bestScore=score;}
        }
        selected.push(best);
    }
    const groups=selected.map(()=>[] as number[]);
    source.forEach((_,i)=>{
        let group=0;for(let j=1;j<selected.length;j++)if(distance(i,selected[j])<distance(i,selected[group]))group=j;
        groups[group].push(i);
    });
    return selected.map((index,group)=>{
        const original=source[index],members=groups[group].length?groups[group]:[index];
        let center:Vec3=[0,0,0],color:Vec3=[0,0,0],area=0;
        for(const i of members){const weight=source[i].halfWidth*source[i].halfLength;area+=weight;center=add(center,scale(source[i].center,weight));color=add(color,scale(source[i].color,weight));}
        // 外周を選んだ代表の位置を残しつつ、担当する葉群の重心へ少し寄せる。
        center=add(scale(original.center,0.65),scale(center,0.35/area));color=scale(color,1/area);
        let width=original.halfWidth,length=original.halfLength;
        for(const i of members)for(const p of corners[i]){
            const d=sub(p,center);width=Math.max(width,Math.abs(dot(d,original.widthAxis)));length=Math.max(length,Math.abs(dot(d,original.lengthAxis)));
        }
        const cap=[1,1.8,2.6,3.6][lod];
        width=Math.min(width,original.halfWidth*cap);length=Math.min(length,original.halfLength*cap);
        // 代表ポリゴンの拡大はLOD0の外接範囲内に制限し、輪郭の過剰な膨張を避ける。
        let fit=1;
        for(const delta of [scale(original.widthAxis,width),scale(original.widthAxis,-width),scale(original.lengthAxis,length),scale(original.lengthAxis,-length)])
            for(let j=0;j<3;j++)if(Math.abs(delta[j])>1e-8)fit=Math.min(fit,(delta[j]>0?max[j]-center[j]:center[j]-min[j])/Math.abs(delta[j]));
        return {...original,center,color,halfWidth:width*Math.max(0.01,fit),halfLength:length*Math.max(0.01,fit),branchIndex:-1};
    });
}
export function createLeafLod(source:LeafClass,classIndex:number,lod:number):LeafClass{
    if(!Number.isInteger(lod)||lod<0||lod>3||!LEAF_LOD_BUDGETS[classIndex])throw new Error('枝葉クラス/LODが範囲外です');
    if(lod===0)return source;
    const budget=LEAF_LOD_BUDGETS[classIndex][lod];
    const indices:number[]=[],vertices:number[]=[];
    for(let b=0;b<budget.branches;b++)for(let i=0;i<3;i++){const j=(i+1)%3,at=b*6;indices.push(at+i,at+j,at+3+i,at+j,at+3+j,at+3+i);}
    for(let l=0;l<budget.leaves;l++){const at=budget.branches*6+l*4;indices.push(at,at+1,at+2,at,at+2,at+3);}
    const variations=source.variations.map(variation=>{
        // 残す枝数はクラス/LODで固定。枝の選択自体は各形状の長さに応じて決めてよい。
        const branches=variation.branches.map((b,i)=>({b,i,length:Math.hypot(...sub(b.end,b.start))})).sort((a,b)=>a.i===b.i?0:a.i===0?-1:b.i===0?1:b.length-a.length).slice(0,budget.branches).map(x=>x.b);
        for(const branch of branches){
            const delta=sub(branch.end,branch.start),axis=unit(delta),u=unit(cross(Math.abs(axis[1])<0.9?[0,1,0]:[1,0,0],axis)),v=cross(axis,u);
            for(let ring=0;ring<2;ring++)for(let i=0;i<3;i++){
                const angle=i*Math.PI*2/3,radial=add(scale(u,Math.cos(angle)),scale(v,Math.sin(angle)));
                const p=add(ring===0?branch.start:branch.end,scale(radial,ring===0?branch.radius0:branch.radius1));
                const n=unit(add(radial,scale(axis,(branch.radius0-branch.radius1)/Math.hypot(...delta))));vertices.push(...p,...n,0.11,0.055,0.023);
            }
        }
        const leaves=reduceLeaves(variation.leaves,budget.leaves,lod);
        for(const leaf of leaves){const n=cross(leaf.widthAxis,leaf.lengthAxis);for(const p of leafCorners(leaf))vertices.push(...p,...n,...leaf.color);}
        return {...variation,branches,leaves};
    });
    return {...source,name:`${source.name} / LOD${lod}`,verticesPerVariation:budget.branches*6+budget.leaves*4,
        triangles:indices.length/3,branchCount:budget.branches,leafCount:budget.leaves,variations,
        vertices:new Float32Array(vertices),indices:new Uint16Array(indices)};
}
export function createLeafLods(library:readonly LeafClass[]):LeafClass[][]{
    return [0,1,2,3].map(lod=>library.map((leaf,c)=>createLeafLod(leaf,c,lod)));
}
// 横並び比較でも元の規模クラスと形状IDを維持し、LODごとに別の描画スロットへ配置する。
export function createLeafLodComparison(lods:readonly LeafClass[][],p:SceneParameters):LeafScene{
    const base=createLeafScene(lods[0],p),gap=base.bounds.max[0]-base.bounds.min[0]+2;
    const min:Vec3=[Infinity,Infinity,Infinity],max:Vec3=[-Infinity,-Infinity,-Infinity];
    const markerVertices:number[]=[],markerIndices:number[]=[];
    const placements=lods.flatMap((library,lod)=>{
        const scene=createLeafScene(library,p),offset=(lod-1.5)*gap;
        for(let j=0;j<3;j++){min[j]=Math.min(min[j],scene.bounds.min[j]+(j===0?offset:0));max[j]=Math.max(max[j],scene.bounds.max[j]+(j===0?offset:0));}
        const vertexOffset=markerVertices.length/9;
        for(let i=0;i<scene.markerVertices.length;i++)markerVertices.push(scene.markerVertices[i]+(i%9===0?offset:0));
        scene.markerIndices.forEach(i=>markerIndices.push(i+vertexOffset));
        return scene.placements.map(data=>{const copy=data.slice();for(let i=0;i<copy.length;i+=12)copy[i]+=offset;return copy;});
    });
    return {placements,markerVertices:new Float32Array(markerVertices),markerIndices:new Uint16Array(markerIndices),bounds:{min,max}};
}
