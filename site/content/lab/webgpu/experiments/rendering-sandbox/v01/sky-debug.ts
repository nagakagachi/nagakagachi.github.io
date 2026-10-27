// SkyLightの入力Mapを左上へ重ねる。シーンと同じPreExposure・表示変換を通す。
export class SkyDebug {
    private constructor(private readonly pipeline: GPURenderPipeline, private readonly group: GPUBindGroup) {}

    static async create(device: GPUDevice, module: GPUShaderModule, map: GPUTextureView,
        cameraBuffer: GPUBuffer): Promise<SkyDebug> {
        const pipeline = await device.createRenderPipelineAsync({ label: 'Sky Octahedralデバッグ', layout: 'auto',
            vertex: { module, entryPoint: 'debugVertex' },
            fragment: { module, entryPoint: 'debugFragment', targets: [{ format: 'rgba16float' }] },
            primitive: { topology: 'triangle-list' },
        });
        const group = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [
            { binding: 0, resource: map }, { binding: 1, resource: { buffer: cameraBuffer } },
        ] });
        return new SkyDebug(pipeline, group);
    }

    encode(encoder: GPUCommandEncoder, target: GPUTextureView, width: number, height: number): void {
        const size = Math.min(192, width - 24, height - 24);
        if (size <= 0) { return; }
        const pass = encoder.beginRenderPass({ label: 'SkyMapDebugPass', colorAttachments: [
            { view: target, loadOp: 'load', storeOp: 'store' },
        ] });
        pass.setViewport(12, 12, size, size, 0, 1);
        pass.setPipeline(this.pipeline);
        pass.setBindGroup(0, this.group);
        pass.draw(3);
        pass.end();
    }
}
