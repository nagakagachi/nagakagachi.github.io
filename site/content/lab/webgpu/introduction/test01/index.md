---
title: "Test01"
layout: "experiment"
outputs: ["HTML", "Source"]
start_label: "開始"
demo_label: "Uniform Bufferによる三角形の回転"
canvas_label: "角度を変更できる三角形"
description: "Uniform BufferとBind Groupで角度を渡し、三角形を回転させるWebGPUの実験"
---

学習用にAgentCodingで生成したデモです

Uniform BufferでCPU側から角度を渡し、頂点シェーダーで三角形を回転させる。初期化から描画まで、このTest内で独立して実装します。

## 操作

「開始」でGPUを初期化して回転を開始します。「停止」で回転を止めます。停止中でも角度スライダーで描画を更新できます。「再開」でその角度から回転を再開します。回転速度は毎秒45度です。別タブへ移ると自動で停止します。

<!-- demo -->

## コードの解説

[Test00](../test00/)で説明したデバイス・Canvas・Shader Module・基本のDraw処理は省略し、追加した部分を抜粋します。実装自体はTest00のコードを参照せず、このTestだけで完結しています。

### HTMLの角度入力

```html
<input id="gpu-angle" type="range" min="0" max="360" step="1" value="0" disabled>
```

ブラウザ標準のスライダーです。0～360度を1度刻みで入力します。初期化成功後にdisabledを解除します。HTMLの入力値は文字列なので、JavaScriptで数値へ変換します。

```javascript
slider.addEventListener('input', () => {
  angle = Number(slider.value);
```

`input`は値を変更している途中にも届くイベントです。停止中もこのイベントからdrawを1回呼び、CPU→GPUの値の更新を確認できます。

### CPU側のデータとGPUBuffer

```javascript
const uniformData = new Float32Array(4);
uniformBuffer = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
```

Float32Arrayは32ビットfloatを連続配置するJavaScriptのTyped Arrayです。GPU用のメモリそのものではなく、CPU側の転送元です。4要素・16バイトを確保します。GPUBufferにはuniform用途と書き込み先用途を指定します。

### WGSLの定数バッファ

```wgsl
struct Uniforms {
  rotation: vec4f,
};
@group(0) @binding(0) var<uniform> uniforms: Uniforms;
```

HLSLのcbufferに近い宣言です。4成分の内容は角度・アスペクト比・未使用・未使用です。group/bindingはWebGPUのバインド番号で、HLSLのregisterやspaceの番号へ直接対応するわけではありません。

### リソースのレイアウト

```javascript
binding: 0, visibility: GPUShaderStage.VERTEX,
buffer: { type: 'uniform', minBindingSize: 16 },
```

`createBindGroupLayout`のentryです。binding 0がuniform bufferで、頂点ステージから読み、少なくとも16バイトを必要とする契約を定義します。Root Signatureでリソースの種類・位置・Shader Visibilityを記述する役割に近いものです。

```javascript
layout: device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] }),
```

PSO作成時に明示的なPipeline Layoutを渡します。配列の0番目がWGSLのgroup 0に対応します。Test00の`layout: 'auto'`からの変更点です。

### 実リソースの登録と描画時の設定

```javascript
binding: 0, resource: { buffer: uniformBuffer, offset: 0, size: 16 },
pass.setBindGroup(0, bindGroup);
```

前の行はBind Group作成時のentry、後ろはDraw前の設定です。レイアウトの契約に対して実際のバッファと範囲を登録し、描画時にgroup 0へ設定します。D3D12のdescriptor tableを設定する役割に近いですが、descriptor heapを直接操作するAPIではありません。

### 毎回の更新

```javascript
uniformData[0] = angle * Math.PI / 180;
uniformData[1] = canvas.width / canvas.height;
device.queue.writeBuffer(uniformBuffer, 0, uniformData);
```

度をラジアンへ変換し、アスペクト比とともに16バイトを書き込みます。writeBufferの後にDrawをsubmitします。同じバッファ・同じBind Groupを使い続け、値だけを更新します。

### 頂点シェーダーで回転

```wgsl
let c = cos(uniforms.rotation.x);
let s = sin(uniforms.rotation.x);
let rotated = vec2f(c * p.x - s * p.y, s * p.x + c * p.y);
output.position = vec4f(rotated.x / uniforms.rotation.y, rotated.y, 0.0, 1.0);
```

2D回転を適用し、最後にX座標を幅÷高さで補正します。行列の転送・格納順の問題を持ち込まず、バッファから値を読む部分に集中した実装です。

### 表示更新の予約と停止

```javascript
frameId = requestAnimationFrame(frame);
```

ブラウザへ次の表示更新タイミングのコールバックを予約します。1回の予約は1回の呼び出しなので、frame内でも次の予約を行います。ネイティブのwhileループでUIスレッドを占有する方式とは異なります。

```javascript
if (lastTime !== null) angle = (angle + (time - lastTime) * 0.045) % 360;
lastTime = time;
```

コールバックの時刻はミリ秒です。経過時間×0.045で毎秒45度進めます。停止・再開時はlastTimeをnullへ戻し、停止中の経過時間を角度へ加算しません。

```javascript
cancelAnimationFrame(frameId);
```

停止時に次の呼び出しの予約をキャンセルします。すでに投入したGPUコマンドを取り消す処理ではありません。

## Uniform Bufferとバインド

Bind Group Layoutはリソースの契約、Bind Groupはその契約を満たす実リソースの組、Pipeline Layoutは使用するgroupの配置です。uniform bufferの値を変えてもバインド関係は変わらないため、各フレームでBind Groupを再作成する必要はありません。

今回はvec4fのサイズとアラインメントが16バイトで、CPU側のFloat32Array(4)と配置が一致します。D3D12のCBVサイズを256バイト単位にする扱いを、そのままこのバッファへ持ち込む必要はありません。一方、WebGPUにもバインドオフセットのアラインメント制約があり、複数データを1バッファへ詰める場合は`device.limits.minUniformBufferOffsetAlignment`を確認します。このデモはoffset 0で動的オフセットも使いません。[WGSLの配置規則](https://www.w3.org/TR/WGSL/#alignment-and-size)

writeBufferはMapしたGPUメモリへの直接代入ではなく、Queue経由の書き込みです。書き込み→描画を同じQueueへ順に投入するため、この用途では毎フレームGPU完了を待つ必要はありません。GPUの実行が遅い場合の投入量制御や高度な更新方式は、このTestの範囲外です。[writeBufferの説明](https://developer.mozilla.org/en-US/docs/Web/API/GPUQueue/writeBuffer)

## ブラウザでの描画ループ

requestAnimationFrameは固定周期のタイマーではありません。画面の表示更新やブラウザの状態に応じて呼び出し頻度が変わるため、フレーム数で角度を進めず、渡された時刻を使います。[requestAnimationFrameの説明](https://developer.mozilla.org/en-US/docs/Web/API/Window/requestAnimationFrame)

このデモでは別タブへ移ると停止し、ページ終了時にバッファとデバイスを破棄します。戻る操作でページが復元された場合は再初期化します。

## 期待される結果

開始するとグラデーションの三角形が反時計回りに回転します。停止後は角度が変わらず、スライダーを操作するとその角度で1回描画します。再開しても描画領域の縦横比によって回転形状が伸び縮みしないよう、回転後のX座標をアスペクト比で補正しています。

## Limitation

WebGPUを利用できるブラウザ・GPU環境と、HTTPSまたはlocalhostでの表示が必要です。内部解像度は960×540で固定です。GPUの機種名を取得できなくても描画は可能です。OSやブラウザが表示更新を抑制した場合、描画頻度は下がることがあります。
