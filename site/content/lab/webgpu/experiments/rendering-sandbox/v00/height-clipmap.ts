export const HEIGHT_SIZE = 1024;
export const MAX_HEIGHT_LEVELS = 7;
export const HEIGHT_LEVEL_BYTES = HEIGHT_SIZE * HEIGHT_SIZE * 2;
export const HEIGHT_JOB_BYTES = 48;
const JOB_STRIDE = 256;
export interface HeightOrigin {
    x: number;
    z: number;
}
export interface HeightRect {
    x: number;
    z: number;
    width: number;
    height: number;
}
export interface TerrainParameters {
    seed: number;
    amplitude: number;
    scale: number;
}
export interface HeightUpdateStats {
    levels: number;
    samples: number;
    rectangles: number;
}
// LOD0/1は同じ1m標高を使い、以後は段ごとに標高間隔を2倍にする。
// 各標高窓の半幅は対応するメッシュ段の半幅の2倍以上となり、補間・法線参照の余裕を持つ。
export function heightLevels(meshLevels: number): number {
    return Math.max(1, meshLevels - 1);
}
export function heightOrigin(x: number, z: number, level: number, size = HEIGHT_SIZE): HeightOrigin {
    const step = 2 ** level;
    // Xは2サンプルずつ動かし、FP16ペアの途中を別dispatchが書かないようにする。
    return { x: Math.floor(x / (2 * step)) * 2 - size / 2, z: Math.floor(z / step) - size / 2 };
}
// 前の窓との重複を保持し、露出した縦帯と、縦帯を除いた横帯だけを返す。
// 座標は世界の標高格子。物理バッファへのラップはComputeで行う。
export function updateRects(previous: HeightOrigin | undefined, next: HeightOrigin, size = HEIGHT_SIZE): HeightRect[] {
    if (!previous || Math.abs(next.x - previous.x) >= size || Math.abs(next.z - previous.z) >= size) {
        return [{ ...next, width: size, height: size }];
    }
    const dx = next.x - previous.x;
    const dz = next.z - previous.z;
    const result: HeightRect[] = [];
    if (dx !== 0) {
        result.push({ x: dx > 0 ? previous.x + size : next.x, z: next.z, width: Math.abs(dx), height: size });
    }
    if (dz !== 0) {
        result.push({ x: Math.max(previous.x, next.x), z: dz > 0 ? previous.z + size : next.z,
            width: size - Math.abs(dx), height: Math.abs(dz) });
    }
    return result;
}
export function terrainBound(parameters: TerrainParameters): number {
    // ノイズ値は0〜1、各帯域の振幅和は1未満。FP16丸めの余裕も含めて保守的に囲う。
    return parameters.amplitude * 0.75 + 2;
}
export class HeightClipmap {
    readonly buffer: GPUBuffer;
    readonly windows = new Int32Array(MAX_HEIGHT_LEVELS * 4);
    readonly bytes: number;
    private readonly jobs: GPUBuffer;
    private readonly group: GPUBindGroup;
    private readonly previous: Array<HeightOrigin | undefined>;
    private dirty = true;
    private disposed = false;
    private readonly device: GPUDevice;
    private readonly pipeline: GPUComputePipeline;
    readonly count: number;
    private parameters: TerrainParameters;
    constructor(device: GPUDevice, pipeline: GPUComputePipeline, count: number, parameters: TerrainParameters) {
        this.device = device;
        this.pipeline = pipeline;
        this.count = count;
        this.parameters = parameters;
        if (!Number.isInteger(count) || count < 1 || count > MAX_HEIGHT_LEVELS) {
            throw new Error('Height Clipmapの段数が範囲外です');
        }
        this.bytes = count * HEIGHT_LEVEL_BYTES;
        this.buffer = device.createBuffer({ label: 'FP16標高Clipmap', size: this.bytes,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
        this.jobs = device.createBuffer({ label: '標高の差分生成条件', size: count * 2 * JOB_STRIDE,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
        this.group = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [
                { binding: 0, resource: { buffer: this.jobs, size: HEIGHT_JOB_BYTES } },
                { binding: 1, resource: { buffer: this.buffer } }
            ] });
        this.previous = Array.from({ length: count });
    }
    regenerate(parameters: TerrainParameters): void {
        this.parameters = parameters;
        this.dirty = true;
    }
    encode(encoder: GPUCommandEncoder, x: number, z: number): HeightUpdateStats {
        const jobs: Array<{
            level: number;
            rect: HeightRect;
        }> = [];
        const stats: HeightUpdateStats = { levels: 0, samples: 0, rectangles: 0 };
        for (let level = 0; level < this.count; level++) {
            const next = heightOrigin(x, z, level);
            const rects = updateRects(this.dirty ? undefined : this.previous[level], next);
            this.windows.set([next.x, next.z, 0, 0], level * 4);
            if (rects.length > 0) {
                stats.levels++;
            }
            for (const rect of rects) {
                jobs.push({ level, rect });
                stats.samples += rect.width * rect.height;
            }
            this.previous[level] = next;
        }
        this.dirty = false;
        stats.rectangles = jobs.length;
        if (jobs.length === 0) {
            return stats;
        }
        // 各矩形のUniformを先にまとめて転送し、dispatchごとは動的オフセットだけを切り替える。
        const data = new ArrayBuffer(jobs.length * JOB_STRIDE);
        const view = new DataView(data);
        for (let i = 0; i < jobs.length; i++) {
            const { level, rect } = jobs[i];
            const offset = i * JOB_STRIDE;
            view.setInt32(offset, rect.x, true);
            view.setInt32(offset + 4, rect.z, true);
            view.setInt32(offset + 8, rect.width, true);
            view.setInt32(offset + 12, rect.height, true);
            view.setUint32(offset + 16, level, true);
            view.setUint32(offset + 20, this.parameters.seed, true);
            view.setFloat32(offset + 32, 2 ** level, true);
            view.setFloat32(offset + 36, this.parameters.amplitude, true);
            view.setFloat32(offset + 40, this.parameters.scale, true);
        }
        this.device.queue.writeBuffer(this.jobs, 0, data);
        const pass = encoder.beginComputePass({ label: '標高Clipmapの差分生成' });
        pass.setPipeline(this.pipeline);
        for (let i = 0; i < jobs.length; i++) {
            const rect = jobs[i].rect;
            pass.setBindGroup(0, this.group, [i * JOB_STRIDE]);
            // 1 invocationが隣接する2サンプルを所有し、1個のu32へ書き込む。
            pass.dispatchWorkgroups(Math.ceil(rect.width / 16), Math.ceil(rect.height / 8));
        }
        pass.end();
        return stats;
    }
    dispose(): void {
        if (this.disposed) {
            return;
        }
        this.disposed = true;
        this.buffer.destroy();
        this.jobs.destroy();
    }
}
