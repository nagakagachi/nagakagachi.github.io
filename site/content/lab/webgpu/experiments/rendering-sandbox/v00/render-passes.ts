export type DepthView = 'main' | 'shadow';

// 今後のメッシュもこの契約で登録する。視点別カリングは描画物側が準備し、
// Pass側は地形固有のIB・頂点形式・可視リストを知らずに呼び出す。
export interface OpaqueRenderable {
    drawDepth(pass: GPURenderPassEncoder, view: DepthView): void;
    drawForward(pass: GPURenderPassEncoder): void;
    drawDebug(pass: GPURenderPassEncoder): void;
}
export interface BackgroundRenderable {
    draw(pass: GPURenderPassEncoder): void;
}
export interface OpaquePipelines {
    zOnly: GPURenderPipeline;
    forward: GPURenderPipeline;
    wire: GPURenderPipeline;
}
export async function createOpaquePipelines(device: GPUDevice, geometryLayout: GPUBindGroupLayout,
    lightingLayout: GPUBindGroupLayout, zOnly: GPUShaderModule, forward: GPUShaderModule,
    format: GPUTextureFormat): Promise<OpaquePipelines> {
    const depthLayout = device.createPipelineLayout({ bindGroupLayouts: [geometryLayout] });
    const shadingLayout = device.createPipelineLayout({ bindGroupLayouts: [geometryLayout, lightingLayout] });
    // 不透明物の深度用バリエーションを2つのPassで共有する。PS・色Attachmentは持たない。
    const depth = await device.createRenderPipelineAsync({ label: 'Opaque ZOnly（Main/Shadow共用）', layout: depthLayout,
        vertex: { module: zOnly, entryPoint: 'depthMain' },
        primitive: { topology: 'triangle-list', frontFace: 'ccw', cullMode: 'back' },
        depthStencil: { format: 'depth32float', depthWriteEnabled: true, depthCompare: 'greater' }
    });
    const shading = await device.createRenderPipelineAsync({ label: 'Opaque Forward Equal', layout: shadingLayout,
        vertex: { module: forward, entryPoint: 'vertexMain' },
        fragment: { module: forward, entryPoint: 'fragmentMain', targets: [{ format }] },
        primitive: { topology: 'triangle-list', frontFace: 'ccw', cullMode: 'back' },
        depthStencil: { format: 'depth32float', depthWriteEnabled: false, depthCompare: 'equal' }
    });
    const wire = await device.createRenderPipelineAsync({ label: 'デバッグワイヤーフレーム', layout: depthLayout,
        vertex: { module: forward, entryPoint: 'wireVertexMain' },
        fragment: { module: forward, entryPoint: 'wireMain', targets: [{ format }] },
        primitive: { topology: 'line-list' },
        depthStencil: { format: 'depth32float', depthWriteEnabled: false, depthCompare: 'greater-equal' }
    });
    return { zOnly: depth, forward: shading, wire };
}
export function encodeOpaquePasses(encoder: GPUCommandEncoder, color: GPUTextureView,
    mainDepth: GPUTextureView, shadowDepth: GPUTextureView, renderables: readonly OpaqueRenderable[],
    shadows: boolean, wire: boolean, background?: BackgroundRenderable): void {
    const prepass = encoder.beginRenderPass({ label: 'ZPrePass', colorAttachments: [],
        depthStencilAttachment: { view: mainDepth, depthClearValue: 0, depthLoadOp: 'clear', depthStoreOp: 'store' }
    });
    for (const object of renderables) { object.drawDepth(prepass, 'main'); }
    prepass.end();

    // メイン深度を先に確定する。将来、ここからSSAO等の深度参照処理を追加できる。
    const shadow = encoder.beginRenderPass({ label: 'ShadowPass', colorAttachments: [],
        depthStencilAttachment: { view: shadowDepth, depthClearValue: 0, depthLoadOp: 'clear', depthStoreOp: 'store' }
    });
    if (shadows) {
        for (const object of renderables) { object.drawDepth(shadow, 'shadow'); }
    }
    shadow.end();

    const forward = encoder.beginRenderPass({ label: 'ForwardShadingPass',
        colorAttachments: [{ view: color, clearValue: { r: 0.025, g: 0.05, b: 0.06, a: 1 }, loadOp: 'clear', storeOp: 'store' }],
        // ReadOnlyのAttachmentにはload/storeを指定しない。ZPrePassの結果をEqual参照する。
        depthStencilAttachment: { view: mainDepth, depthReadOnly: true }
    });
    for (const object of renderables) { object.drawForward(forward); }
    // 最遠方のSkyを深度比較し、地形のない画素だけにピクセルレイを実行する。
    background?.draw(forward);
    if (wire) {
        for (const object of renderables) { object.drawDebug(forward); }
    }
    forward.end();
}
