import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
// ブラウザ向け参照を、このCPUテスト内だけで原本へ解決する。
const hook=registerHooks({resolve(specifier,context,next){
    if(['./branch-cluster.js','./placements.js','./leaf-library.js','./tree-model.js','./wood-mesh.js'].includes(specifier) && context.parentURL?.includes('/foliage-modeler/')) return next(specifier.replace('.js','.ts'),context);
    return next(specifier,context);
}});
const {createLeafLibrary,createLeafScene,DEFAULT_PARAMETERS,DEFAULT_LIBRARY_PARAMETERS}=await import('../site/content/lab/webgpu/experiments/rendering-sandbox/v03/foliage-modeler/leaf-library.ts');
const {createTreeScene,DEFAULT_TREE_PARAMETERS,TREE_PRESETS}=await import('../site/content/lab/webgpu/experiments/rendering-sandbox/v03/foliage-modeler/tree-model.ts');
const {transformPoint,rotateVector}=await import('../site/content/lab/webgpu/experiments/rendering-sandbox/v03/foliage-modeler/placements.ts');
const {createTreeAssets,createTreePreviewScene}=await import('../site/content/lab/webgpu/experiments/rendering-sandbox/v03/foliage-modeler/tree-preview.ts');
const {createWoodGeometry,DEFAULT_WOOD_PARAMETERS}=await import('../site/content/lab/webgpu/experiments/rendering-sandbox/v03/foliage-modeler/wood-mesh.ts');
hook.deregister();

test('全クラスでPrim予算・共有接続・4バリエーションの頂点領域が整合する',()=>{
    const library=createLeafLibrary();
    assert.equal(library.length,3);
    library.forEach((c,i)=>{
        assert.equal(c.indices.length,[32,64,128][i]*3);
        assert.equal(c.leafCount,[10,20,52][i]);
        assert.equal(c.branchCount,[2,4,4][i]);
        assert.equal(c.variationCount,4);
        assert.equal(c.verticesPerVariation,c.branchCount*6+c.leafCount*4);
        assert.equal(c.vertices.length,c.verticesPerVariation*4*9);
        assert.ok(c.indices.every(v=>v<c.verticesPerVariation));
        c.variations.forEach(v=>{
            assert.equal(v.branches.length,c.branchCount);
            assert.equal(v.leaves.length,c.leafCount);
            for(const leaf of v.leaves) {
                assert.ok(leaf.branchIndex>=0&&leaf.branchIndex<c.branchCount);
                const root=leaf.center.map((x,j)=>x-leaf.lengthAxis[j]*leaf.halfLength);
                const branch=v.branches[leaf.branchIndex];
                const delta=branch.end.map((x,j)=>x-branch.start[j]);
                const rel=root.map((x,j)=>x-branch.start[j]);
                const t=rel.reduce((s,x,j)=>s+x*delta[j],0)/delta.reduce((s,x)=>s+x*x,0);
                assert.ok(t>=0&&t<=1);
                assert.ok(Math.hypot(...rel.map((x,j)=>x-t*delta[j]))<1e-6);
            }
        });
    });
});
test('倍率の端・全プリセットで有限値と単位法線、非縮退・正しい面向きを保つ',()=>{
    for(const factor of [0.5,1,1.5]) {
        const library=createLeafLibrary({...DEFAULT_LIBRARY_PARAMETERS,spread:factor,opening:factor,depth:factor,leafSize:factor});
        for(const c of library) for(let variant=0;variant<4;variant++) {
            const offset=variant*c.verticesPerVariation*9,p=c.vertices;
            assert.ok(p.every(Number.isFinite));
            for(let v=0;v<c.verticesPerVariation;v++) assert.ok(Math.abs(Math.hypot(...p.slice(offset+v*9+3,offset+v*9+6))-1)<1e-6);
            for(let t=0;t<c.indices.length;t+=3) {
                const [a,b,d]=[...c.indices.slice(t,t+3)].map(i=>offset+i*9);
                const u=[0,1,2].map(j=>p[b+j]-p[a+j]),v=[0,1,2].map(j=>p[d+j]-p[a+j]);
                const n=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]];
                assert.ok(Math.hypot(...n)>1e-9);
                assert.ok(n.reduce((s,x,j)=>s+x*(p[a+3+j]+p[b+3+j]+p[d+3+j]),0)>0);
            }
        }
    }
});
test('再現性・色と形状の独立性・固定トポロジを保つ',()=>{
    const a=createLeafLibrary();
    assert.deepEqual(a,createLeafLibrary());
    const debug=createLeafLibrary({...DEFAULT_LIBRARY_PARAMETERS,debugColors:true});
    for(let c=0;c<3;c++) for(let at=0;at<a[c].vertices.length;at+=9) assert.deepEqual(a[c].vertices.slice(at,at+6),debug[c].vertices.slice(at,at+6));
    assert.notDeepEqual(a[2].vertices,createLeafLibrary({...DEFAULT_LIBRARY_PARAMETERS,seed:99})[2].vertices);
    assert.deepEqual(a.map(c=>c.indices),createLeafLibrary({...DEFAULT_LIBRARY_PARAMETERS,leafSize:1.5}).map(c=>c.indices));
    assert.throws(()=>createLeafLibrary({...DEFAULT_LIBRARY_PARAMETERS,seed:NaN}));
    assert.throws(()=>createLeafLibrary({...DEFAULT_LIBRARY_PARAMETERS,depth:2}));
});
test('配置IDと境界が全クラス・単独表示で全頂点を覆う',()=>{
    const library=createLeafLibrary();
    for(const selected of [-1,0,1,2]) for(const scale of [0.5,2]) {
        const scene=createLeafScene(library,{...DEFAULT_PARAMETERS,classIndex:selected,leafScale:scale});
        scene.placements.forEach((data,c)=>{
            assert.equal(data.byteLength,selected===-1||selected===c?4*48:0);
            const ids=new Uint32Array(data.buffer);
            for(let i=0;i<data.length/12;i++) {
                assert.equal(ids[i*12+8],i);
                for(let v=0;v<library[c].verticesPerVariation;v++) for(let j=0;j<3;j++) {
                    const x=data[i*12+j]+data[i*12+3]*library[c].vertices[(i*library[c].verticesPerVariation+v)*9+j];
                    assert.ok(x>=scene.bounds.min[j]-1e-5&&x<=scene.bounds.max[j]+1e-5);
                }
            }
        });
    }
});

test('単独バリエーションの非ゼロIDを維持し、トポロジを変えずに配置する',()=>{
    const library=createLeafLibrary();
    for(const selected of [-1,0,2]) {
        const scene=createLeafScene(library,{...DEFAULT_PARAMETERS,classIndex:selected,variationIndex:3});
        scene.placements.forEach((data,i)=>{
            if(selected>=0&&i!==selected) { assert.equal(data.length,0);return; }
            assert.equal(data.byteLength,48);
            assert.equal(new Uint32Array(data.buffer)[8],3);
        });
    }
    assert.throws(()=>createLeafScene(library,{...DEFAULT_PARAMETERS,variationIndex:4}));
});

test('木は主幹メッシュなしで中心線上に取り付け、回転後の全頂点を境界が覆う',()=>{
    const library=createLeafLibrary();
    for(const bend of [0,3]) for(const count of [4,48]) {
        const scene=createTreeScene(library,{...DEFAULT_TREE_PARAMETERS,bend,socketCount:count,classIndex:-1,variationIndex:-1});
        assert.equal(scene.markerVertices.length,0);assert.equal(scene.markerIndices.length,0);
        assert.equal(scene.tree.sockets.length,count);
        assert.equal(scene.placements.reduce((n,p)=>n+p.length/12,0),count);
        assert.equal(scene.debugLines.length,scene.tree.branches.reduce((sum,b)=>sum+(b.points.length-1)*6,0));
        for(const socket of scene.tree.sockets) {
            const {placement:p,segment:s,fraction:t}=socket;
            const points=scene.tree.branches[socket.branchId].points;
            const a=points[s],b=points[s+1];
            assert.ok(Math.abs(Math.hypot(...p.rotation)-1)<1e-6);
            assert.ok(p.scale>0);
            for(let j=0;j<3;j++)assert.ok(Math.abs(p.position[j]-(a[j]+(b[j]-a[j])*t))<1e-6);
            // Quaternionの原点は取り付け位置へ移り、回転はベクトル長を保つ。
            assert.deepEqual(transformPoint([0,0,0],p),p.position);
            assert.ok(Math.abs(Math.hypot(...rotateVector([0,1,0],p.rotation))-1)<1e-6);
            const mesh=library[socket.classIndex];
            for(let v=0;v<mesh.verticesPerVariation;v++) {
                const at=(p.variationId*mesh.verticesPerVariation+v)*9;
                const point=transformPoint([...mesh.vertices.slice(at,at+3)],p);
                for(let j=0;j<3;j++)assert.ok(point[j]>=scene.bounds.min[j]-1e-5&&point[j]<=scene.bounds.max[j]+1e-5);
            }
        }
        const hidden=createTreeScene(library,{...DEFAULT_TREE_PARAMETERS,bend,socketCount:count,classIndex:-1,variationIndex:-1,showTrunk:false});
        assert.equal(hidden.debugLines.length,0);
        assert.deepEqual(hidden.placements,scene.placements);
        assert.deepEqual(hidden.bounds,scene.bounds);
    }
});
test('樹木の再現性と48byte配置レイアウトを保つ',()=>{
    const library=createLeafLibrary(),p={...DEFAULT_TREE_PARAMETERS,variationIndex:3};
    const scene=createTreeScene(library,p);
    assert.deepEqual(scene,createTreeScene(library,p));
    for(const data of scene.placements) for(let i=0;i<data.length/12;i++) {
        const words=new Uint32Array(data.buffer);
        assert.equal(words[i*12+8],3);
        assert.ok(Math.abs(Math.hypot(...data.slice(i*12+4,i*12+8))-1)<1e-6);
    }
    assert.throws(()=>createTreeScene(library,{...p,socketCount:100}));
});

test('6樹形と主要枝0〜3本で、骨格接合・取り付け・有限値を保つ',()=>{
    const library=createLeafLibrary();
    const signatures=new Set();
    for(const form of ['conical','oval','rounded','umbrella','vase','weeping']) {
        for(const majorBranches of [0,1,2,3]) {
            const scene=createTreeScene(library,{...DEFAULT_TREE_PARAMETERS,form,majorBranches,shape:TREE_PRESETS[form].shape});
            assert.equal(scene.tree.branches.length,majorBranches+1);
            assert.equal(scene.tree.sockets.length,DEFAULT_TREE_PARAMETERS.socketCount);
            assert.ok(scene.placements.every(p=>p.every(Number.isFinite)));
            assert.ok(scene.debugLines.every(Number.isFinite));
            for(const b of scene.tree.branches.slice(1)) {
                assert.equal(b.parentId,0);
                const parent=scene.tree.branches[b.parentId].points;
                for(let j=0;j<3;j++) {
                    const root=parent[b.parentSegment][j]+(parent[b.parentSegment+1][j]-parent[b.parentSegment][j])*b.parentFraction;
                    assert.ok(Math.abs(root-b.points[0][j])<1e-6);
                }
            }
            for(const socket of scene.tree.sockets) {
                const c=library[socket.classIndex],p=socket.placement;
                for(let v=0;v<c.verticesPerVariation;v+=3) {
                    const at=(p.variationId*c.verticesPerVariation+v)*9;
                    const point=transformPoint([...c.vertices.slice(at,at+3)],p);
                    for(let j=0;j<3;j++)assert.ok(point[j]>=scene.bounds.min[j]-1e-5&&point[j]<=scene.bounds.max[j]+1e-5);
                }
                const points=scene.tree.branches[socket.branchId].points;
                for(let j=0;j<3;j++) assert.ok(Math.abs(socket.placement.position[j]-(points[socket.segment][j]+(points[socket.segment+1][j]-points[socket.segment][j])*socket.fraction))<1e-6);
            }
            if(majorBranches===3) signatures.add(JSON.stringify(scene.tree.branches));
        }
    }
    assert.equal(signatures.size,6);
    assert.throws(()=>createTreeScene(library,{...DEFAULT_TREE_PARAMETERS,majorBranches:4}));
    assert.throws(()=>createTreeScene(library,{...DEFAULT_TREE_PARAMETERS,form:'invalid'}));
});


test('プリセット名は生成結果に影響せず、共通パラメータで発生位置と曲線を変える',()=>{
    const library=createLeafLibrary(),p={...DEFAULT_TREE_PARAMETERS};
    const original=createTreeScene(library,p);
    assert.deepEqual(original,createTreeScene(library,{...p,form:'conical'}));
    for(const shape of [
        {...p.shape,birthStart:0,birthEnd:0.2},
        {...p.shape,inclination:90},
        {...p.shape,droop:0.8},
        {...p.shape,curvature:-90},
        {...p.shape,azimuthStep:45}
    ]) assert.notDeepEqual(original.tree.branches,createTreeScene(library,{...p,shape}).tree.branches);
    const low=createTreeScene(library,{...p,shape:{...p.shape,birthStart:0.1,birthEnd:0.1}});
    for(const branch of low.tree.branches.slice(1)) assert.ok(Math.abs(branch.points[0][1]-p.height*p.shape.trunkRatio*0.1)<1e-6);
    for(const trunkShare of [0,1]) {
        const scene=createTreeScene(library,{...p,shape:{...p.shape,trunkShare}});
        assert.equal(scene.tree.sockets.filter(s=>s.branchId===0).length,trunkShare?p.socketCount:0);
        assert.ok(scene.placements.every(data=>data.every(Number.isFinite)));
    }
    assert.throws(()=>createTreeScene(library,{...p,shape:{...p.shape,birthStart:1,birthEnd:0}}));
    assert.throws(()=>createTreeScene(library,{...p,shape:{...p.shape,curvature:NaN}}));
});


test('幹の全LOD・枝数で共有IB、端面、面向き、有限な単位法線を保つ',()=>{
    const library=createLeafLibrary();
    for(let majorBranches=0;majorBranches<=3;majorBranches++) {
        const p={...DEFAULT_TREE_PARAMETERS,majorBranches};
        const trees=[0,1].map(seed=>createTreeScene(library,{...p,seed}).tree);
        let previous=Infinity;
        for(let lod=0;lod<3;lod++) {
            const geometry=createWoodGeometry(trees,p.height,DEFAULT_WOOD_PARAMETERS,lod);
            assert.ok(geometry.indices.length<previous);previous=geometry.indices.length;
            assert.equal(geometry.vertices.length,geometry.verticesPerVariation*2*9);
            assert.ok(geometry.verticesPerVariation<65536);
            assert.ok(geometry.vertices.every(Number.isFinite));
            const single=createWoodGeometry([trees[1]],p.height,DEFAULT_WOOD_PARAMETERS,lod);
            assert.deepEqual(single.indices,geometry.indices);
            for(let i=0;i<geometry.vertices.length;i+=9) assert.ok(Math.abs(Math.hypot(...geometry.vertices.slice(i+3,i+6))-1)<1e-5);
            for(let variation=0;variation<2;variation++) for(let i=0;i<geometry.indices.length;i+=3) {
                const points=[0,1,2].map(j=>{
                    const at=(variation*geometry.verticesPerVariation+geometry.indices[i+j])*9;
                    return [...geometry.vertices.slice(at,at+9)];
                });
                const a=points[1].slice(0,3).map((v,j)=>v-points[0][j]);
                const b=points[2].slice(0,3).map((v,j)=>v-points[0][j]);
                const cross=[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
                assert.ok(Math.hypot(...cross)>1e-9);
                const normal=[0,1,2].map(j=>points.reduce((sum,p)=>sum+p[j+3],0));
                assert.ok(cross.reduce((sum,v,j)=>sum+v*normal[j],0)>0);
            }
        }
    }
});

test('樹木配置数を増やしても形状VB/IBを共有し、各配置の形状IDと境界を保つ',()=>{
    const library=createLeafLibrary(),p={...DEFAULT_TREE_PARAMETERS};
    const assets=createTreeAssets(library,p,DEFAULT_WOOD_PARAMETERS,4);
    for(const count of [1,9,100]) {
        const scene=createTreePreviewScene(library,assets,count,0,true,true);
        assert.equal(scene.wood.geometry,assets.wood[0]);
        assert.equal(scene.wood.placements.byteLength,count*48);
        assert.equal(scene.placements.reduce((n,p)=>n+p.length/12,0),count*p.socketCount);
        const data=scene.wood.placements,ids=new Uint32Array(data.buffer);
        for(let i=0;i<count;i++) {
            const variation=i%4;assert.equal(ids[i*12+8],variation);
            const placement={position:[...data.slice(i*12,i*12+3)],scale:data[i*12+3],rotation:[...data.slice(i*12+4,i*12+8)],variationId:variation};
            for(let v=0;v<assets.wood[0].verticesPerVariation;v++) {
                const at=(variation*assets.wood[0].verticesPerVariation+v)*9;
                const point=transformPoint([...assets.wood[0].vertices.slice(at,at+3)],placement);
                for(let j=0;j<3;j++)assert.ok(point[j]>=scene.bounds.min[j]-1e-4&&point[j]<=scene.bounds.max[j]+1e-4);
            }
        }
    }
    const hidden=createTreePreviewScene(library,assets,9,2,false,false);
    assert.equal(hidden.debugLines.length,0);assert.ok(hidden.placements.every(p=>p.length===0));
    assert.equal(hidden.wood.geometry,assets.wood[2]);
    assert.throws(()=>createTreePreviewScene(library,assets,101,0,false,true));
    assert.throws(()=>createWoodGeometry([assets.trees[0].tree],8,{radiusRatio:NaN,taper:1},0));
});
