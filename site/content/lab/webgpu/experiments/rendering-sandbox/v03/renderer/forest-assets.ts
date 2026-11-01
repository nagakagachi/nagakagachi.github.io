import {createLeafLods} from '../foliage-modeler/leaf-lod.js';
import {createLeafLibrary} from '../foliage-modeler/leaf-library.js';
import {createTreeScene,DEFAULT_TREE_PARAMETERS,TREE_PRESETS} from '../foliage-modeler/tree-model.js';
import {createWoodGeometry,DEFAULT_WOOD_PARAMETERS} from '../foliage-modeler/wood-mesh.js';

// 円錐・卵・しだれを同じ主要枝数/トポロジに揃え、形状IDだけで切り替える。
export function createForestAssets() {
    const library=createLeafLibrary({seed:1234,spread:1.1,opening:1,depth:1.1,leafSize:1.2,debugColors:false});
    const forms=['conical','oval','weeping'] as const;
    const trees=forms.map((form,i)=>createTreeScene(library,{
        ...DEFAULT_TREE_PARAMETERS,seed:1234+i*1723,form,majorBranches:3,
        shape:TREE_PRESETS[form].shape,crownWidth:8,classIndex:1,variationIndex:i,showTrunk:false
    }));
    return {library,leafLods:createLeafLods(library),trees,wood:[0,1,2].map(lod=>createWoodGeometry(trees.map(s=>s.tree),DEFAULT_TREE_PARAMETERS.height,DEFAULT_WOOD_PARAMETERS,lod))};
}
