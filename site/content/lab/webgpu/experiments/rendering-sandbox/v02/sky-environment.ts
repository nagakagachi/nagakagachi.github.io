import { skyRayFrame } from './render-math.js';
import type { Vec3 } from './render-math.js';
import type { BackgroundRenderable } from './render-passes.js';

export const SKY_MAP_SIZE = 256;
export const SKY_SH_COEFFICIENTS = 9;
export const SKY_GROUPS = SKY_MAP_SIZE * SKY_MAP_SIZE / 64;
export interface SkyModules {
    generate: GPUShaderModule;
    project: GPUShaderModule;
    reduce: GPUShaderModule;
    render: GPUShaderModule;
}
interface SkyPipelines {
    generate: GPUComputePipeline;
    project: GPUComputePipeline;
    reduce: GPUComputePipeline;
    render: GPURenderPipeline;
}
export class SkyEnvironment implements BackgroundRenderable {
    readonly map: GPUTexture;
    readonly coefficients: GPUBuffer;
    private readonly partials: GPUBuffer;
    private readonly parameters: GPUBuffer;
    private readonly view: GPUBuffer;
    private readonly generateGroup: GPUBindGroup;
    private readonly projectGroup: GPUBindGroup;
    private readonly reduceGroup: GPUBindGroup;
    private readonly renderGroup: GPUBindGroup;
    private previousLight: Vec3 | undefined;
    private previousAltitude: number | undefined;
    private disposed = false;
    revision = 0;
    private readonly device: GPUDevice;
    private readonly pipelines: SkyPipelines;

    static async create(device: GPUDevice, modules: SkyModules, format: GPUTextureFormat, cameraBuffer: GPUBuffer): Promise<SkyEnvironment> {
        const generate = await device.createComputePipelineAsync({ label: 'Sky Octahedral生成', layout: 'auto', compute: { module: modules.generate, entryPoint: 'generateSky' } });
        const project = await device.createComputePipelineAsync({ label: 'Sky SH局所投影', layout: 'auto', compute: { module: modules.project, entryPoint: 'projectSky' } });
        const reduce = await device.createComputePipelineAsync({ label: 'Sky SH最終集約', layout: 'auto', compute: { module: modules.reduce, entryPoint: 'reduceSky' } });
        const render = await device.createRenderPipelineAsync({ label: 'Skyピクセルレイ', layout: 'auto',
            vertex: { module: modules.render, entryPoint: 'skyVertex' },
            fragment: { module: modules.render, entryPoint: 'skyFragment', targets: [{ format }] },
            primitive: { topology: 'triangle-list' },
            depthStencil: { format: 'depth32float', depthWriteEnabled: false, depthCompare: 'greater-equal' }
        });
        return new SkyEnvironment(device, { generate, project, reduce, render }, cameraBuffer);
    }
    private constructor(device: GPUDevice, pipelines: SkyPipelines, cameraBuffer: GPUBuffer) {
        this.device = device;
        this.pipelines = pipelines;
        this.map = device.createTexture({ label: 'Sky Octahedral 256²', size: [SKY_MAP_SIZE, SKY_MAP_SIZE], format: 'rgba16float',
            usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC });
        this.coefficients = device.createBuffer({ label: 'Sky 2次SH 9係数RGB', size: SKY_SH_COEFFICIENTS * 16,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_SRC });
        this.partials = device.createBuffer({ label: 'Sky SH局所和', size: SKY_GROUPS * SKY_SH_COEFFICIENTS * 16, usage: GPUBufferUsage.STORAGE });
        this.parameters = device.createBuffer({ label: 'Sky生成条件', size: 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
        this.view = device.createBuffer({ label: 'Skyピクセルレイの基底', size: 48, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
        this.generateGroup = device.createBindGroup({ layout: pipelines.generate.getBindGroupLayout(0), entries: [
            { binding: 0, resource: { buffer: this.parameters } }, { binding: 1, resource: this.map.createView() }
        ] });
        this.projectGroup = device.createBindGroup({ layout: pipelines.project.getBindGroupLayout(0), entries: [
            { binding: 0, resource: this.map.createView() }, { binding: 1, resource: { buffer: this.partials } }
        ] });
        this.reduceGroup = device.createBindGroup({ layout: pipelines.reduce.getBindGroupLayout(0), entries: [
            { binding: 0, resource: { buffer: this.partials } }, { binding: 1, resource: { buffer: this.coefficients } }
        ] });
        this.renderGroup = device.createBindGroup({ layout: pipelines.render.getBindGroupLayout(0), entries: [
            { binding: 0, resource: { buffer: this.parameters } }, { binding: 1, resource: { buffer: this.view } }, { binding: 2, resource: { buffer: cameraBuffer } }
        ] });
    }
    encode(encoder: GPUCommandEncoder, light: Vec3, yaw: number, pitch: number, aspect: number, observerAltitude = 200, verticalFov = Math.PI / 3): boolean {
        const rays = skyRayFrame(yaw, pitch, aspect, verticalFov);
        this.device.queue.writeBuffer(this.view, 0, rays);
        const changed = this.previousAltitude !== observerAltitude || !this.previousLight || light.some((value, i) => value !== this.previousLight?.[i]);
        if (!changed) { return false; }
        this.device.queue.writeBuffer(this.parameters, 0, new Float32Array([...light, 0, observerAltitude, 0, 0, 0]));
        // 各段の依存をCompute Pass境界で区切る。係数のCPU読戻しやグローバルAtomicは不要。
        const generate = encoder.beginComputePass({ label: 'SkyOctahedralPass' });
        generate.setPipeline(this.pipelines.generate);
        generate.setBindGroup(0, this.generateGroup);
        generate.dispatchWorkgroups(SKY_MAP_SIZE / 8, SKY_MAP_SIZE / 8);
        generate.end();
        const project = encoder.beginComputePass({ label: 'SkySHProjectPass' });
        project.setPipeline(this.pipelines.project);
        project.setBindGroup(0, this.projectGroup);
        project.dispatchWorkgroups(SKY_GROUPS);
        project.end();
        const reduce = encoder.beginComputePass({ label: 'SkySHReducePass' });
        reduce.setPipeline(this.pipelines.reduce);
        reduce.setBindGroup(0, this.reduceGroup);
        reduce.dispatchWorkgroups(1);
        reduce.end();
        this.previousLight = [...light];
        this.previousAltitude = observerAltitude;
        this.revision++;
        return true;
    }
    draw(pass: GPURenderPassEncoder): void {
        pass.setPipeline(this.pipelines.render);
        pass.setBindGroup(0, this.renderGroup);
        pass.draw(3);
    }
    dispose(): void {
        if (this.disposed) { return; }
        this.disposed = true;
        this.map.destroy();
        this.coefficients.destroy();
        this.partials.destroy();
        this.parameters.destroy();
        this.view.destroy();
    }
}
