import test from 'node:test';
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
// 同じv03内のブラウザ向け参照だけを、CPUテストではTS原本へ解決する。
const hook=registerHooks({resolve(specifier,context,next){
    if(specifier.startsWith('.')&&specifier.endsWith('.js')&&context.parentURL?.includes('/rendering-sandbox/v03/'))return next(specifier.replace(/\.js$/,'.ts'),context);
    return next(specifier,context);
}});
const {createForestAssets}=await import('../site/content/lab/webgpu/experiments/rendering-sandbox/v03/renderer/forest-assets.ts');
const {buildCascades}=await import('../site/content/lab/webgpu/experiments/rendering-sandbox/v03/renderer/cascaded-shadows.ts');
hook.deregister();
test('円錐・卵・しだれは3種の広葉樹部品を使い、幹は同じIBを共有できる',()=>{
    const assets=createForestAssets();assert.equal(assets.trees.length,3);
    assert.equal(new Set(assets.trees.map(s=>JSON.stringify(s.tree.branches))).size,3);
    assets.trees.forEach((s,i)=>{
        assert.equal(s.tree.branches.length,4);
        assert.equal(s.tree.sockets.length,24);
        assert.ok(s.tree.sockets.every(socket=>socket.classIndex===1&&socket.placement.variationId===i));
    });
    for(const mesh of assets.wood){
        assert.equal(mesh.variationCount,3);assert.equal(mesh.vertices.length,mesh.verticesPerVariation*3*9);
        assert.ok(mesh.indices.every(i=>i<mesh.verticesPerVariation));
        assert.ok(mesh.vertices.every(Number.isFinite));
    }
});
test('近中景CSMは256mを4段に分け、最初の3段を約10/27/77mへ割り当てる',()=>{
    const cascades=buildCascades([0,200,0],0,0,Math.PI/3,16/9,[0.6,0.8,0],256,24000);
    const expected=[10.075,27.25,76.825,256];
    cascades.forEach((c,i)=>assert.ok(Math.abs(c.split-expected[i])<1e-6));
});
