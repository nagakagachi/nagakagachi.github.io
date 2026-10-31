import { createTreeScene } from './tree-model.js';
import type { TreeParameters } from './tree-model.js';
import { createWoodGeometry } from './wood-mesh.js';
import type { WoodParameters } from './wood-mesh.js';
import type { LeafClass, LeafScene, Vec3 } from './leaf-library.js';
import { packPlacements, transformPoint } from './placements.js';
import type { Placement, Quaternion } from './placements.js';

export function createTreeAssets(library:readonly LeafClass[],p:TreeParameters,wood:WoodParameters,variations:number) {
    if(!Number.isInteger(variations)||variations<1||variations>4)throw new Error('樹木の形状数は1〜4です');
    const trees=Array.from({length:variations},(_,i)=>createTreeScene(library,{...p,seed:(p.seed+Math.imul(i,2654435761))>>>0,showTrunk:true}));
    return {trees,wood:Array.from({length:3},(_,lod)=>createWoodGeometry(trees.map(s=>s.tree),p.height,wood,lod)),spacing:Math.max(p.height,p.crownWidth)*1.3};
}
export function createTreePreviewScene(library:readonly LeafClass[],assets:ReturnType<typeof createTreeAssets>,count:number,lod:number,showLines:boolean,showLeaves:boolean):LeafScene {
    if(!Number.isInteger(count)||count<1||count>100||!Number.isInteger(lod)||!assets.wood[lod])throw new Error('樹木プレビューの設定が範囲外です');
    const leafLists:Placement[][]=library.map(()=>[]),woodList:Placement[]=[],lines:number[]=[];
    const min:Vec3=[Infinity,Infinity,Infinity],max:Vec3=[-Infinity,-Infinity,-Infinity];
    const include=(v:Vec3):void=>{for(let j=0;j<3;j++){min[j]=Math.min(min[j],v[j]);max[j]=Math.max(max[j],v[j]);}};
    const geometry=assets.wood[lod],columns=Math.ceil(Math.sqrt(count));
    for(let i=0;i<count;i++) {
        const variationId=i%assets.trees.length,tree=assets.trees[variationId];
        const angle=count===1?0:i*2.399963;
        const world:Placement={position:[((i%columns)-(columns-1)/2)*assets.spacing,0,(Math.floor(i/columns)-(Math.ceil(count/columns)-1)/2)*assets.spacing],
            rotation:[0,Math.sin(angle/2),0,Math.cos(angle/2)],scale:1,variationId};
        woodList.push(world);
        // 葉部品の形状は共有。初版では取り付け配置だけをCPUでワールド空間へ展開する。
        if(showLeaves)for(const socket of tree.tree.sockets) {
            const local=socket.placement,a=world.rotation,b=local.rotation;
            const rotation:Quaternion=[a[3]*b[0]+a[0]*b[3]+a[1]*b[2]-a[2]*b[1],a[3]*b[1]-a[0]*b[2]+a[1]*b[3]+a[2]*b[0],a[3]*b[2]+a[0]*b[1]-a[1]*b[0]+a[2]*b[3],a[3]*b[3]-a[0]*b[0]-a[1]*b[1]-a[2]*b[2]];
            leafLists[socket.classIndex].push({...local,position:transformPoint(local.position,world),rotation});
        }
        for(let v=0;v<geometry.verticesPerVariation;v++) {
            const at=(variationId*geometry.verticesPerVariation+v)*9;
            include(transformPoint([geometry.vertices[at],geometry.vertices[at+1],geometry.vertices[at+2]],world));
        }
        if(showLeaves)for(const x of [tree.bounds.min[0],tree.bounds.max[0]])for(const y of [tree.bounds.min[1],tree.bounds.max[1]])for(const z of [tree.bounds.min[2],tree.bounds.max[2]])include(transformPoint([x,y,z],world));
        if(showLines)for(const branch of tree.tree.branches)for(let j=0;j<branch.points.length-1;j++)lines.push(...transformPoint(branch.points[j],world),...transformPoint(branch.points[j+1],world));
    }
    return {wood:{geometry,placements:packPlacements(woodList)},placements:leafLists.map(packPlacements),debugLines:new Float32Array(lines),
        markerVertices:new Float32Array(0),markerIndices:new Uint16Array(0),bounds:{min,max}};
}
