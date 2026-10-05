const button = document.querySelector('#gpu-start');
const status = document.querySelector('#gpu-status');
const canvas = document.querySelector('#gpu-canvas');
const info = document.querySelector('#gpu-info');
let device;
let context;
let failed = false;
function detail(label, value) {
  const dt = document.createElement('dt');
  const dd = document.createElement('dd');
  dt.textContent = label;
  dd.textContent = value;
  info.append(dt, dd);
}
function fail(message) {
  failed = true;
  status.textContent = message;
  context?.unconfigure();
  button.disabled = false;
}
button.addEventListener('click', async () => {
  button.disabled = true;
  failed = false;
  info.replaceChildren();
  status.textContent = 'WebGPUを初期化しています';
  try {
    context?.unconfigure();
    device?.destroy();
    device = undefined;
    if (!window.isSecureContext) throw new Error('HTTPSまたはlocalhostで開いてください');
    if (!navigator.gpu) throw new Error('このブラウザ環境ではWebGPUを利用できません');
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) throw new Error('利用可能なGPUアダプターを取得できませんでした');
    const currentDevice = await adapter.requestDevice();
    device = currentDevice;
    currentDevice.lost.then(({ reason, message }) => {
      if (device === currentDevice && reason !== 'destroyed') fail(`GPUデバイスを失いました: ${message || reason}`);
    });
    currentDevice.addEventListener('uncapturederror', event => fail(`GPUエラー: ${event.error.message}`));
    context = canvas.getContext('webgpu');
    if (!context) throw new Error('WebGPUのCanvasを取得できませんでした');
    const format = navigator.gpu.getPreferredCanvasFormat();
    context.configure({ device, format, alphaMode: 'opaque' });
    const shaderResponse = await fetch(new URL('./triangle.wgsl', import.meta.url));
    if (!shaderResponse.ok) throw new Error(`WGSLの取得に失敗しました: ${shaderResponse.status}`);
    const shader = device.createShaderModule({ code: await shaderResponse.text() });
    const compilation = await shader.getCompilationInfo();
    const errors = compilation.messages.filter(message => message.type === 'error');
    if (errors.length) throw new Error(errors.map(message => message.message).join('; '));
    const pipeline = await device.createRenderPipelineAsync({
      layout: 'auto',
      vertex: { module: shader, entryPoint: 'vertexMain' },
      fragment: { module: shader, entryPoint: 'fragmentMain', targets: [{ format }] },
      primitive: { topology: 'triangle-list' },
    });
    device.pushErrorScope('validation');
    const encoder = device.createCommandEncoder();
    const pass = encoder.beginRenderPass({ colorAttachments: [{
      view: context.getCurrentTexture().createView(),
      clearValue: { r: 0.09, g: 0.12, b: 0.14, a: 1 },
      loadOp: 'clear', storeOp: 'store',
    }] });
    pass.setPipeline(pipeline);
    pass.draw(3);
    pass.end();
    device.queue.submit([encoder.finish()]);
    const validation = await device.popErrorScope();
    if (validation) throw new Error(validation.message);
    await device.queue.onSubmittedWorkDone();
    if (failed) return;
    detail('描画形式', format);
    detail('描画サイズ', `${canvas.width} × ${canvas.height}`);
    detail('GPU情報', adapter.info?.description || '機種名を取得できませんでした');
    status.textContent = '描画完了';
    button.textContent = '再実行';
  } catch (error) {
    fail(`実行できませんでした: ${error.message}`);
  } finally {
    button.disabled = false;
  }
});
window.addEventListener('pagehide', () => { context?.unconfigure(); device?.destroy(); });
