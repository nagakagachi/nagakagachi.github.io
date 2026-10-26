// Forwardと天球の線形HDR出力を受け取り、Canvasへ表示する最終Pass。
export class PostProcess {
    private constructor(
        private readonly device: GPUDevice,
        private readonly pipeline: GPURenderPipeline,
        private readonly group: GPUBindGroup,
        private readonly parameters: GPUBuffer,
    ) {}

    static async create(device: GPUDevice, module: GPUShaderModule,
        source: GPUTextureView, format: GPUTextureFormat): Promise<PostProcess> {
        const pipeline = await device.createRenderPipelineAsync({
            label: 'HDR Tonemapping', layout: 'auto',
            vertex: { module, entryPoint: 'postVertex' },
            fragment: { module, entryPoint: 'postFragment', targets: [{ format }] },
            primitive: { topology: 'triangle-list' },
        });
        const parameters = device.createBuffer({ label: '表示用露出', size: 16,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
        try {
            const group = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [
                { binding: 0, resource: source }, { binding: 1, resource: { buffer: parameters } },
            ] });
            return new PostProcess(device, pipeline, group, parameters);
        } catch (error) {
            parameters.destroy();
            throw error;
        }
    }

    encode(encoder: GPUCommandEncoder, destination: GPUTextureView, exposure: number): void {
        this.device.queue.writeBuffer(this.parameters, 0, new Float32Array([exposure, 0, 0, 0]));
        const pass = encoder.beginRenderPass({ label: 'PostProcessPass', colorAttachments: [
            { view: destination, loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 1] },
        ] });
        pass.setPipeline(this.pipeline);
        pass.setBindGroup(0, this.group);
        pass.draw(3);
        pass.end();
    }

    dispose(): void {
        this.parameters.destroy();
    }
}
