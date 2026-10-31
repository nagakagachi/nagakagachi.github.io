import type { LeafClass, LeafScene, Vec3, MeshGeometry } from './leaf-library.js';
import { PLACEMENT_BYTES, PLACEMENT_FLOATS } from './placements.js';

export interface OrbitCamera { yaw: number; pitch: number; distance: number; target: Vec3 }

function viewProjection(camera: OrbitCamera, aspect: number): Float32Array<ArrayBuffer> {
    const { yaw, pitch, distance, target } = camera;
    const z: Vec3 = [Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch)];
    const x: Vec3 = [Math.cos(yaw), 0, -Math.sin(yaw)];
    const y: Vec3 = [-Math.sin(yaw) * Math.sin(pitch), Math.cos(pitch), -Math.cos(yaw) * Math.sin(pitch)];
    const eye = target.map((v, i) => v + z[i] * distance);
    const dot = (v: Vec3): number => v.reduce((sum, n, i) => sum + n * eye[i], 0);
    const f = 1 / Math.tan(Math.PI / 8), sx = f / aspect;
    // near=0.05mのInfinity-far Reversed Z。
    return new Float32Array([x[0]*sx, y[0]*f, 0, -z[0], x[1]*sx, y[1]*f, 0, -z[1],
        x[2]*sx, y[2]*f, 0, -z[2], -dot(x)*sx, -dot(y)*f, 0.05, dot(z)]);
}

export async function createPreview(canvas: HTMLCanvasElement, library: readonly LeafClass[], reportError: (message: string) => void) {
    if (!navigator.gpu) throw new Error('このブラウザではWebGPUを利用できません');
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) throw new Error('WebGPUアダプターを取得できません');
    const device = await adapter.requestDevice();
    let disposed = false;
    device.addEventListener('uncapturederror', event => reportError(event.error.message));
    void device.lost.then(info => { if (!disposed) reportError(`GPUデバイスが失われました：${info.message}`); });
    const context = canvas.getContext('webgpu');
    if (!context) { device.destroy(); throw new Error('WebGPUのCanvasを取得できません'); }
    const shader = async (name: string): Promise<GPUShaderModule> => {
        const response = await fetch(new URL(name, import.meta.url));
        if (!response.ok) throw new Error(`${name}を取得できません：${response.status}`);
        const bytes = new Uint8Array(await response.arrayBuffer());
        if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) throw new Error(`${name}にBOMがあります`);
        let code: string;
        try { code = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
        catch { throw new Error(`${name}が不正なUTF-8です`); }
        const module = device.createShaderModule({ label: name, code });
        const info = await module.getCompilationInfo();
        const errors = info.messages.filter(message => message.type === 'error');
        if (errors.length) throw new Error(`${name}: ${errors.map(e => e.message).join('\n')}`);
        return module;
    };
    try {
        const module = await shader('preview.wgsl'), displayModule = await shader('display.wgsl');
        const format = navigator.gpu.getPreferredCanvasFormat();
        context.configure({ device, format, alphaMode: 'opaque' });
        const cameraBuffer = device.createBuffer({ size: 80, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
        const cameraLayout = device.createBindGroupLayout({ entries: [{ binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } }] });
        const layout = device.createPipelineLayout({ bindGroupLayouts: [cameraLayout] });
        const cameraGroup = device.createBindGroup({ layout: cameraLayout, entries: [{ binding: 0, resource: { buffer: cameraBuffer } }] });
        const buffers: GPUVertexBufferLayout[] = [{ arrayStride: 36, attributes: [
            { shaderLocation: 0, offset: 0, format: 'float32x3' },
            { shaderLocation: 1, offset: 12, format: 'float32x3' },
            { shaderLocation: 2, offset: 24, format: 'float32x3' }
        ] }];
        const depthPipeline = await device.createRenderPipelineAsync({ layout,
            vertex: { module, entryPoint: 'depthVertex', buffers }, primitive: { cullMode: 'back' },
            depthStencil: { format: 'depth32float', depthWriteEnabled: true, depthCompare: 'greater' } });
        const forwardPipeline = await device.createRenderPipelineAsync({ layout,
            vertex: { module, entryPoint: 'surfaceVertex', buffers }, primitive: { cullMode: 'back' },
            fragment: { module, entryPoint: 'shade', targets: [{ format: 'rgba16float' }] },
            depthStencil: { format: 'depth32float', depthWriteEnabled: false, depthCompare: 'equal' } });
        const leafLayout = device.createBindGroupLayout({ entries: [
            { binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
            { binding: 1, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
            { binding: 2, visibility: GPUShaderStage.VERTEX, buffer: { type: 'uniform' } }
        ] });
        const leafPipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [cameraLayout, leafLayout] });
        const leafDepthPipeline = await device.createRenderPipelineAsync({ layout: leafPipelineLayout,
            vertex: { module, entryPoint: 'leafDepthVertex' }, primitive: { cullMode: 'none' },
            depthStencil: { format: 'depth32float', depthWriteEnabled: true, depthCompare: 'greater' } });
        const leafForwardPipeline = await device.createRenderPipelineAsync({ layout: leafPipelineLayout,
            vertex: { module, entryPoint: 'leafSurfaceVertex' }, primitive: { cullMode: 'none' },
            fragment: { module, entryPoint: 'shade', targets: [{ format: 'rgba16float' }] },
            depthStencil: { format: 'depth32float', depthWriteEnabled: false, depthCompare: 'equal' } });
        // 幹も葉と同じStorage VB参照を使うが、不透明管は背面をカリングする。
        const woodDepthPipeline = await device.createRenderPipelineAsync({layout:leafPipelineLayout,
            vertex:{module,entryPoint:'leafDepthVertex'},primitive:{cullMode:'back'},
            depthStencil:{format:'depth32float',depthWriteEnabled:true,depthCompare:'greater'}});
        const woodForwardPipeline = await device.createRenderPipelineAsync({layout:leafPipelineLayout,
            vertex:{module,entryPoint:'leafSurfaceVertex'},primitive:{cullMode:'back'},
            fragment:{module,entryPoint:'shade',targets:[{format:'rgba16float'}]},
            depthStencil:{format:'depth32float',depthWriteEnabled:false,depthCompare:'equal'}});
        const linePipeline = await device.createRenderPipelineAsync({ layout,
            vertex: { module, entryPoint:'lineVertex', buffers:[{arrayStride:12,attributes:[{shaderLocation:0,offset:0,format:'float32x3'}]}] },
            primitive: { topology:'line-list' },
            fragment: { module, entryPoint:'lineColor', targets:[{format:'rgba16float'}] },
            depthStencil: {format:'depth32float',depthWriteEnabled:false,depthCompare:'greater-equal'}
        });
        const displayPipeline = await device.createRenderPipelineAsync({ layout: 'auto',
            vertex: { module: displayModule, entryPoint: 'fullscreen' },
            fragment: { module: displayModule, entryPoint: 'display', targets: [{ format }] } });
        let vertexBuffer: GPUBuffer | undefined, indexBuffer: GPUBuffer | undefined, indexCount = 0;
        let depth: GPUTexture | undefined, hdr: GPUTexture | undefined, displayGroup: GPUBindGroup | undefined;
        let width = 0, height = 0;
        let lineBuffer: GPUBuffer | undefined, lineCount=0;
        const upload = (data: Float32Array<ArrayBuffer> | Uint16Array<ArrayBuffer> | Uint32Array<ArrayBuffer>, usage: GPUBufferUsageFlags, label: string): GPUBuffer => {
            const buffer = device.createBuffer({ label, size: Math.ceil(data.byteLength/4)*4, usage: usage | GPUBufferUsage.COPY_DST });
            device.queue.writeBuffer(buffer, 0, data);
            return buffer;
        };
        // バリエーションの頂点と共有IBは初期化時に一度転送し、配置変更では作り直さない。
        const createResource = (leaf: MeshGeometry) => {
            const vertices = upload(leaf.vertices, GPUBufferUsage.STORAGE, '形状 Storage VB');
            const indices = upload(leaf.indices, GPUBufferUsage.INDEX, '共有IB');
            const parameters = upload(new Uint32Array([leaf.verticesPerVariation, 0, 0, 0]), GPUBufferUsage.UNIFORM, 'クラスの頂点数');
            const placements = device.createBuffer({ size: leaf.variationCount * PLACEMENT_BYTES, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
            const group = device.createBindGroup({ layout: leafLayout, entries: [
                { binding: 0, resource: { buffer: vertices } }, { binding: 1, resource: { buffer: placements } },
                { binding: 2, resource: { buffer: parameters } }
            ] });
            return { vertices, indices, parameters, placements, group, count: leaf.indices.length, instances: leaf.variationCount };
        };
        const leafResources = library.map(createResource);
        let woodGeometry: MeshGeometry | undefined;
        let woodResource: ReturnType<typeof createResource> | undefined;
        const destroyResource=(r:ReturnType<typeof createResource>):void=>{
            r.vertices.destroy();r.indices.destroy();r.parameters.destroy();r.placements.destroy();
        };
        const setPlacements=(r:ReturnType<typeof createResource>,data:Float32Array<ArrayBuffer>):void=>{
            r.instances=data.length/PLACEMENT_FLOATS;
            if(data.byteLength>r.placements.size) {
                r.placements.destroy();
                r.placements=device.createBuffer({size:2**Math.ceil(Math.log2(data.byteLength)),usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST});
                r.group=device.createBindGroup({layout:leafLayout,entries:[
                    {binding:0,resource:{buffer:r.vertices}},{binding:1,resource:{buffer:r.placements}},{binding:2,resource:{buffer:r.parameters}}
                ]});
            }
            if(data.length)device.queue.writeBuffer(r.placements,0,data);
        };
        return {
            get resourceBytes(): number {
                return cameraBuffer.size + (vertexBuffer?.size ?? 0) + (indexBuffer?.size ?? 0) + (lineBuffer?.size ?? 0)
                    + (woodResource ? woodResource.vertices.size+woodResource.indices.size+woodResource.parameters.size+woodResource.placements.size:0)
                    + leafResources.reduce((sum, r) => sum+r.vertices.size+r.indices.size+r.parameters.size+r.placements.size, 0);
            },
            updateLibrary(library: readonly LeafClass[]): void {
                // 同じトポロジ・同じ容量のまま頂点の内容だけを置き換える。
                library.forEach((leaf,i) => device.queue.writeBuffer(leafResources[i].vertices,0,leaf.vertices));
            },
            setScene(scene: LeafScene): void {
                vertexBuffer?.destroy(); indexBuffer?.destroy();
                vertexBuffer = scene.markerVertices.length?upload(scene.markerVertices, GPUBufferUsage.VERTEX, '目印の幹VB'):undefined;
                indexBuffer = scene.markerIndices.length?upload(scene.markerIndices, GPUBufferUsage.INDEX, '目印の幹IB'):undefined;
                indexCount = scene.markerIndices.length;
                lineBuffer?.destroy();
                lineCount=(scene.debugLines?.length ?? 0)/3;
                lineBuffer=scene.debugLines?.length?upload(scene.debugLines,GPUBufferUsage.VERTEX,'主幹デバッグライン'):undefined;
                scene.placements.forEach((data,i)=>setPlacements(leafResources[i],data));
                if(scene.wood?.geometry!==woodGeometry) {
                    if(woodResource)destroyResource(woodResource);
                    woodGeometry=scene.wood?.geometry;
                    woodResource=woodGeometry?createResource(woodGeometry):undefined;
                }
                if(woodResource&&scene.wood)setPlacements(woodResource,scene.wood.placements);

            },
            draw(camera: OrbitCamera, silhouette = false): void {
                if (disposed) return;
                const ratio = Math.min(window.devicePixelRatio, 2);
                const w = Math.min(device.limits.maxTextureDimension2D, Math.max(1, Math.round(canvas.clientWidth * ratio)));
                const h = Math.min(device.limits.maxTextureDimension2D, Math.max(1, Math.round(canvas.clientHeight * ratio)));
                if (w !== width || h !== height) {
                    width = canvas.width = w; height = canvas.height = h;
                    depth?.destroy(); hdr?.destroy();
                    depth = device.createTexture({ size: [w, h], format: 'depth32float', usage: GPUTextureUsage.RENDER_ATTACHMENT });
                    hdr = device.createTexture({ size: [w, h], format: 'rgba16float', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING });
                    displayGroup = device.createBindGroup({ layout: displayPipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: hdr.createView() }] });
                }
                if (!depth || !hdr || !displayGroup) return;
                device.queue.writeBuffer(cameraBuffer, 0, viewProjection(camera, w / h));
                device.queue.writeBuffer(cameraBuffer,64,new Uint32Array([silhouette?1:0,0,0,0]));
                const encoder = device.createCommandEncoder();
                const draw = (pass: GPURenderPassEncoder, pipeline: GPURenderPipeline, leafPipeline: GPURenderPipeline, woodPipeline: GPURenderPipeline): void => {
                    pass.setBindGroup(0, cameraGroup);
                    if (vertexBuffer && indexBuffer && indexCount) {
                        pass.setPipeline(pipeline);
                        pass.setVertexBuffer(0, vertexBuffer); pass.setIndexBuffer(indexBuffer, 'uint16');
                        pass.drawIndexed(indexCount);
                    }
                    if(woodResource?.instances) {
                        pass.setPipeline(woodPipeline);pass.setBindGroup(1,woodResource.group);
                        pass.setIndexBuffer(woodResource.indices,'uint16');
                        pass.drawIndexed(woodResource.count,woodResource.instances);
                    }
                    pass.setPipeline(leafPipeline);
                    // 同じクラスの全バリエーションを一つのIndexed Instanced Drawで描画する。
                    for (const resource of leafResources) {
                        if (!resource.instances) continue;
                        pass.setBindGroup(1, resource.group);
                        pass.setIndexBuffer(resource.indices, 'uint16');
                        pass.drawIndexed(resource.count, resource.instances);
                    }
                    pass.end();
                };
                draw(encoder.beginRenderPass({ label: 'ZPrePass', colorAttachments: [], depthStencilAttachment: {
                    view: depth.createView(), depthClearValue: 0, depthLoadOp: 'clear', depthStoreOp: 'store'
                } }), depthPipeline, leafDepthPipeline, woodDepthPipeline);
                draw(encoder.beginRenderPass({ label: 'Forward', colorAttachments: [{ view: hdr.createView(),
                    clearValue: silhouette?[0,0,0,1]:[0.015,0.025,0.035,1], loadOp: 'clear', storeOp: 'store' }],
                    depthStencilAttachment: { view: depth.createView(), depthReadOnly: true }
                }), forwardPipeline, leafForwardPipeline, woodForwardPipeline);
                if (lineBuffer && lineCount) {
                    const lines=encoder.beginRenderPass({label:'主幹デバッグ',colorAttachments:[{view:hdr.createView(),loadOp:'load',storeOp:'store'}],
                        depthStencilAttachment:{view:depth.createView(),depthReadOnly:true}});
                    lines.setPipeline(linePipeline);lines.setBindGroup(0,cameraGroup);
                    lines.setVertexBuffer(0,lineBuffer);lines.draw(lineCount);lines.end();
                }
                const post = encoder.beginRenderPass({ label: 'Tonemapping', colorAttachments: [{ view: context.getCurrentTexture().createView(), loadOp: 'clear', storeOp: 'store' }] });
                post.setPipeline(displayPipeline); post.setBindGroup(0, displayGroup); post.draw(3); post.end();
                device.queue.submit([encoder.finish()]);
            },
            dispose(): void {
                disposed = true;
                vertexBuffer?.destroy(); indexBuffer?.destroy(); cameraBuffer.destroy(); depth?.destroy(); hdr?.destroy(); lineBuffer?.destroy();
                for (const r of leafResources) destroyResource(r);
                if(woodResource)destroyResource(woodResource);
                context.unconfigure(); device.destroy();
            }
        };
    } catch (error) {
        disposed = true; context.unconfigure(); device.destroy(); throw error;
    }
}
