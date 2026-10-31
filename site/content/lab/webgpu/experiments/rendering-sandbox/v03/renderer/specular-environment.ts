export class SpecularEnvironment {
    readonly map: GPUTexture;
    readonly lut: GPUTexture;
    readonly sampler: GPUSampler;
    private readonly parameters: GPUBuffer[]=[];
    private readonly groups: GPUBindGroup[]=[];
    private readonly lutGroup: GPUBindGroup;
    private initialized=false;
    private constructor(private readonly device: GPUDevice,private readonly prefilter: GPUComputePipeline,
        private readonly integrate: GPUComputePipeline,source: GPUTextureView) {
        this.map=device.createTexture({label:'GGX Octahedral Mip chain',size:[256,256],mipLevelCount:5,format:'rgba16float',
            usage:GPUTextureUsage.STORAGE_BINDING|GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_SRC});
        this.lut=device.createTexture({label:'Split Sum BRDF LUT',size:[128,128],format:'rgba16float',
            usage:GPUTextureUsage.STORAGE_BINDING|GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_SRC});
        this.sampler=device.createSampler({minFilter:'linear',magFilter:'linear',mipmapFilter:'linear'});
        for(let mip=0;mip<5;mip++) {
            const uniform=device.createBuffer({size:16,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
            this.parameters.push(uniform);device.queue.writeBuffer(uniform,0,new Float32Array([mip/4,0,0,0]));
            this.groups.push(device.createBindGroup({layout:prefilter.getBindGroupLayout(0),entries:[
                {binding:0,resource:source},{binding:1,resource:this.map.createView({baseMipLevel:mip,mipLevelCount:1})},
                {binding:2,resource:{buffer:uniform}}]}));
        }
        this.lutGroup=device.createBindGroup({layout:integrate.getBindGroupLayout(0),entries:[{binding:0,resource:this.lut.createView()}]});
    }
    static async create(device:GPUDevice,prefilter:GPUShaderModule,lut:GPUShaderModule,source:GPUTextureView):Promise<SpecularEnvironment> {
        const p=await device.createComputePipelineAsync({layout:'auto',compute:{module:prefilter,entryPoint:'prefilterMain'}});
        const b=await device.createComputePipelineAsync({layout:'auto',compute:{module:lut,entryPoint:'integrateBRDF'}});
        return new SpecularEnvironment(device,p,b,source);
    }
    encode(encoder:GPUCommandEncoder,changed:boolean):void {
        if(!this.initialized) {
            const pass=encoder.beginComputePass({label:'BRDF LUT初期生成'});pass.setPipeline(this.integrate);
            pass.setBindGroup(0,this.lutGroup);pass.dispatchWorkgroups(16,16);pass.end();this.initialized=true;
        }
        if(!changed) { return; }
        // 分離した各MipのStorage Viewへ書き、後続のForwardで一括して参照する。
        const pass=encoder.beginComputePass({label:'GGX Octahedral Prefilter'});pass.setPipeline(this.prefilter);
        for(let mip=0;mip<5;mip++) { const size=Math.max(1,256>>mip);pass.setBindGroup(0,this.groups[mip]);pass.dispatchWorkgroups(Math.ceil(size/8),Math.ceil(size/8)); }
        pass.end();
    }
    dispose():void { this.map.destroy();this.lut.destroy();this.parameters.forEach(p=>p.destroy()); }
}
