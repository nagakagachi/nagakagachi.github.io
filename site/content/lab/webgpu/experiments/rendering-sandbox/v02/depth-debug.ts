// メインビューはRawDepth/LinearDepthを全画面表示、CSMは常にRawDepthを小窓表示する。
export class DepthDebug {
    private constructor(private readonly device: GPUDevice, private readonly rawPipeline: GPURenderPipeline,
        private readonly linearPipeline: GPURenderPipeline, private readonly mainGroup: GPUBindGroup,
        private readonly shadowGroup: GPUBindGroup, private readonly linearGroup: GPUBindGroup,
        private readonly range: GPUBuffer) {}

    static async create(device: GPUDevice, module: GPUShaderModule, mainDepth: GPUTextureView,
        shadowDepth: GPUTextureView, format: GPUTextureFormat): Promise<DepthDebug> {
        const pipeline = (entryPoint: string): Promise<GPURenderPipeline> => device.createRenderPipelineAsync({
            label: entryPoint === 'linearDepthFragment' ? 'LinearDepth表示' : 'RawDepth表示', layout: 'auto',
            vertex: { module, entryPoint: 'depthDebugVertex' },
            fragment: { module, entryPoint, targets: [{ format }] },
            primitive: { topology: 'triangle-list' },
        });
        const raw = await pipeline('depthDebugFragment');
        const linear = await pipeline('linearDepthFragment');
        const range = device.createBuffer({ label: 'LinearDepthの正規化距離', size: 16,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
        const group = (view: GPUTextureView): GPUBindGroup => device.createBindGroup({
            layout: raw.getBindGroupLayout(0), entries: [{ binding: 0, resource: view }],
        });
        const linearGroup = device.createBindGroup({ layout: linear.getBindGroupLayout(0), entries: [
            { binding: 0, resource: mainDepth }, { binding: 1, resource: { buffer: range } },
        ] });
        return new DepthDebug(device, raw, linear, group(mainDepth), group(shadowDepth), linearGroup, range);
    }

    dispose(): void { this.range.destroy(); }

    encodeMain(encoder: GPUCommandEncoder, target: GPUTextureView, linear = false, normalizationDistance = 1000): void {
        if (linear) {
            this.device.queue.writeBuffer(this.range, 0, new Float32Array([1, Math.max(10, normalizationDistance), 0, 0]));
        }
        const pass = encoder.beginRenderPass({ label: linear ? 'LinearDepthの全画面表示' : 'RawDepthの全画面表示', colorAttachments: [
            { view: target, loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 1] },
        ] });
        pass.setPipeline(linear ? this.linearPipeline : this.rawPipeline);
        pass.setBindGroup(0, linear ? this.linearGroup : this.mainGroup);
        pass.draw(3);
        pass.end();
    }

    encodeShadow(encoder: GPUCommandEncoder, target: GPUTextureView, width: number, height: number, slot: number): void {
        const size = Math.min(192, width - 24, height - 24);
        if (size <= 0) { return; }
        const pass = encoder.beginRenderPass({ label: 'シャドウAtlasのRawDepth表示', colorAttachments: [
            { view: target, loadOp: 'load', storeOp: 'store' },
        ] });
        pass.setViewport(12 + slot * (size + 12), 12, size, size, 0, 1);
        pass.setPipeline(this.rawPipeline);
        pass.setBindGroup(0, this.shadowGroup);
        pass.draw(3);
        pass.end();
    }
}
