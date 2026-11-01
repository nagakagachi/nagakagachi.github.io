import test from 'node:test';
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
const hook=registerHooks({resolve(specifier,context,next){
    if(specifier.startsWith('.')&&specifier.endsWith('.js')&&context.parentURL?.includes('/rendering-sandbox/v03/'))return next(specifier.replace(/\.js$/,'.ts'),context);
    return next(specifier,context);
}});
const {createLeafLibrary}=await import('../site/content/lab/webgpu/experiments/rendering-sandbox/v03/foliage-modeler/leaf-library.ts');
const {createLeafLods,createLeafLod,createLeafLodComparison,leafCorners}=await import('../site/content/lab/webgpu/experiments/rendering-sandbox/v03/foliage-modeler/leaf-lod.ts');
hook.deregister();
test('規模クラスを保った4LODで、頂点数・IB・バリエーションの領域が整合する',()=>{
    const base=createLeafLibrary(),lods=createLeafLods(base),expected=[[32,16,6,4],[64,32,16,6],[128,64,32,12]];
    for(let c=0;c<3;c++){
        assert.equal(lods[0][c],base[c]);
        for(let l=0;l<4;l++){
            const mesh=lods[l][c];assert.equal(mesh.triangles,expected[c][l]);
            assert.equal(mesh.vertices.length,mesh.verticesPerVariation*9*4);
            assert.ok(mesh.indices.every(i=>i<mesh.verticesPerVariation));
            assert.ok(mesh.vertices.every(Number.isFinite));
            for(let at=0;at<mesh.vertices.length;at+=9)assert.ok(Math.abs(Math.hypot(...mesh.vertices.slice(at+3,at+6))-1)<1e-5);
            for(let v=0;v<4;v++)for(let i=0;i<mesh.indices.length;i+=3){
                const points=[0,1,2].map(j=>[...mesh.vertices.slice((v*mesh.verticesPerVariation+mesh.indices[i+j])*9,(v*mesh.verticesPerVariation+mesh.indices[i+j])*9+3)]);
                const a=points[1].map((n,j)=>n-points[0][j]),b=points[2].map((n,j)=>n-points[0][j]);
                assert.ok(Math.hypot(a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0])>1e-9);
            }
        }
    }
    assert.deepEqual(lods,createLeafLods(base));
    assert.throws(()=>createLeafLod(base[0],0,4));
});
test('低LODの代表葉はLOD0の外接範囲を越えず、3方向の広がりを残す',()=>{
    const base=createLeafLibrary(),lods=createLeafLods(base);
    for(let c=0;c<3;c++)for(let v=0;v<4;v++){
        const points=base[c].variations[v].leaves.flatMap(leafCorners);
        const min=[0,1,2].map(j=>Math.min(...points.map(p=>p[j]))),max=[0,1,2].map(j=>Math.max(...points.map(p=>p[j])));
        for(let lod=1;lod<4;lod++){
            const proxy=lods[lod][c].variations[v].leaves.flatMap(leafCorners);
            for(let j=0;j<3;j++){
                const lo=Math.min(...proxy.map(p=>p[j])),hi=Math.max(...proxy.map(p=>p[j]));
                assert.ok(lo>=min[j]-1e-5&&hi<=max[j]+1e-5);
                assert.ok((hi-lo)/(max[j]-min[j])>0.35,`クラス${c}・形状${v}・LOD${lod}・軸${j}`);
            }
        }
    }
});
test('LOD比較は同クラスの4段を別バッチへ配置し、LODごとのマーカーも維持する',()=>{
    const lods=createLeafLods(createLeafLibrary()),scene=createLeafLodComparison(lods,{markerHeight:0.75,leafScale:1,classIndex:1,variationIndex:1});
    assert.equal(scene.placements.length,12);
    assert.deepEqual(scene.placements.map(p=>p.length>0),[false,true,false,false,true,false,false,true,false,false,true,false]);
    assert.equal(scene.markerIndices.length,4*36);
});
