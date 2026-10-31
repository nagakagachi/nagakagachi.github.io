// SkyLightの入力Mapを左上へ重ねる。シーンと同じPreExposure・表示変換を通す。
export class SkyDebug {
    private constructor(private readonly pipeline: GPURenderPipeline, private readonly group: GPUBindGroup,private readonly parameters:GPUBuffer,private readonly device:GPUDevice) {}

    static async create(device: GPUDevice, module: GPUShaderModule, map: GPUTextureView,
        cameraBuffer: GPUBuffer): Promise<SkyDebug> {
        const pipeline = await device.createRenderPipelineAsync({ label: 'Sky Octahedralデバッグ', layout: 'auto',
            vertex: { module, entryPoint: 'debugVertex' },
            fragment: { module, entryPoint: 'debugFragment', targets: [{ format: 'rgba16float' }] },
            primitive: { topology: 'triangle-list' },
        });
        const parameters=device.createBuffer({size:16,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
        const group = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [
            { binding: 0, resource: map }, { binding: 1, resource: { buffer: cameraBuffer } },
            { binding:2,resource:{buffer:parameters}},
        ] });
        return new SkyDebug(pipeline, group,parameters,device);
    }

    dispose():void { this.parameters.destroy(); }
    encode(encoder: GPUCommandEncoder, target: GPUTextureView, width: number, height: number,mip=0,slot=0): void {
        this.device.queue.writeBuffer(this.parameters,0,new Uint32Array([mip,0,0,0]));
        const size = Math.min(192, width - 24, height - 24);
        if (size <= 0) { return; }
        const pass = encoder.beginRenderPass({ label: 'SkyMapDebugPass', colorAttachments: [
            { view: target, loadOp: 'load', storeOp: 'store' },
        ] });
        pass.setViewport(12+slot*(size+12), 12, size, size, 0, 1);
        pass.setPipeline(this.pipeline);
        pass.setBindGroup(0, this.group);
        pass.draw(3);
        pass.end();
    }
}
