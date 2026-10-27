// PreExposure済みのHDR出力へ、トーンマッピングと表示色変換だけを適用する。
export class PostProcess {
    private constructor(private readonly pipeline: GPURenderPipeline, private readonly group: GPUBindGroup) {}

    static async create(device: GPUDevice, module: GPUShaderModule,
        source: GPUTextureView, format: GPUTextureFormat): Promise<PostProcess> {
        const pipeline = await device.createRenderPipelineAsync({
            label: 'HDR Tonemapping', layout: 'auto',
            vertex: { module, entryPoint: 'postVertex' },
            fragment: { module, entryPoint: 'postFragment', targets: [{ format }] },
            primitive: { topology: 'triangle-list' },
        });
        const group = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [
            { binding: 0, resource: source },
        ] });
        return new PostProcess(pipeline, group);
    }

    encode(encoder: GPUCommandEncoder, destination: GPUTextureView): void {
        const pass = encoder.beginRenderPass({ label: 'PostProcessPass', colorAttachments: [
            { view: destination, loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 1] },
        ] });
        pass.setPipeline(this.pipeline);
        pass.setBindGroup(0, this.group);
        pass.draw(3);
        pass.end();
    }
}
