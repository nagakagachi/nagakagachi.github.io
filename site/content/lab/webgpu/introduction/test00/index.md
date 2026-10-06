---
title: "Test00"
layout: "experiment"
outputs: ["HTML", "Source"]
demo_label: "WebGPU三角形デモ"
canvas_label: "WebGPUで描画する三角形"
description: "WebGPUの対応状況を確認し、WGSLで三角形を描画する入門デモ"
---

学習用にAgentCodingで生成したデモです

WebGPUの初期化と、最小限の描画パイプラインを確認する。下のボタンでGPUを取得し、WGSLの頂点シェーダーとフラグメントシェーダーで三角形を描画します。

描画は一度だけ実行します。未対応や初期化失敗の場合は、状態欄に理由を表示します。

<!-- demo -->

## コードの解説

以下は実装の抜粋です。DirectX 12との対応は役割の比較であり、APIの一対一対応ではありません。全文は末尾の「ソース」から確認できます。

### HTMLの描画先とモジュール

```html
<canvas id="gpu-canvas" width="960" height="540" ...></canvas>
<script type="module" src=".../main.js"></script>
```

`canvas`はHTML内の描画領域です。widthとheightは内部の描画解像度で、CSSの表示サイズとは別です。ウィンドウと表示サーフェスを用意する役割に近いものです。

`type="module"`でJavaScriptをモジュールとして読み込みます。このコードはブラウザのCPU側で動き、WGSLだけがGPUで実行されます。`...`は抜粋のための省略です。

### HTML要素の取得とクリック処理

```javascript
const button = document.querySelector('#gpu-start');
const canvas = document.querySelector('#gpu-canvas');
button.addEventListener('click', async () => {
```

`document`はブラウザが用意するHTML文書のオブジェクトです。`querySelector`はCSSセレクターで要素を探し、`#`はidを指定します。取得したbuttonへクリックのコールバックを登録します。

`async`関数内の`await`は非同期処理の結果を待ちます。UIスレッドを同期的にブロックする待ちではなく、処理を中断して結果が届いたら続きを実行します。

### アダプターとデバイス

```javascript
if (!navigator.gpu) throw new Error('このブラウザ環境ではWebGPUを利用できません');
const adapter = await navigator.gpu.requestAdapter();
const currentDevice = await adapter.requestDevice();
```

`navigator.gpu`はブラウザ組み込みのWebGPU APIの入口です。役割として、アダプター取得とD3D12デバイス作成に近い順序です。実装ではadapterがnullの場合も確認しています。deviceからリソースやパイプラインを作ります。

### Canvasを表示先として設定

```javascript
context = canvas.getContext('webgpu');
const format = navigator.gpu.getPreferredCanvasFormat();
context.configure({ device, format, alphaMode: 'opaque' });
```

CanvasのWebGPUコンテキストを取得し、デバイスと表示用フォーマットを関連付けます。swap chainの設定に近い役割ですが、DXGIのswap chainを直接操作するものではありません。`opaque`はCanvasの表示を不透明として扱う指定です。

### WGSLファイルの取得

```javascript
const shaderResponse = await fetch(new URL('./triangle.wgsl', import.meta.url));
const shader = device.createShaderModule({ code: await shaderResponse.text() });
```

`fetch`はURLからファイルを取得するブラウザAPIです。`import.meta.url`は実行中のmain.jsのURLなので、そこを基準に同じフォルダのWGSLを解決します。OSのファイルパスを開いているわけではありません。

取得した文字列をShader Moduleに渡します。HLSLバイナリを事前生成する構成とは異なり、このデモはWGSLのソースをブラウザへ渡します。

### パイプライン

```javascript
layout: 'auto',
vertex: { module: shader, entryPoint: 'vertexMain' },
fragment: { module: shader, entryPoint: 'fragmentMain', targets: [{ format }] },
primitive: { topology: 'triangle-list' },
```

`createRenderPipelineAsync`へ渡す設定の抜粋です。Graphics PSOに近く、VS・PSのエントリー、RTフォーマット、プリミティブ種類を指定します。`fragment`がピクセルシェーダー相当です。今回はリソースをバインドしないためレイアウトは自動推論にしています。

### 描画先とコマンド記録

```javascript
const encoder = device.createCommandEncoder();
view: context.getCurrentTexture().createView(),
loadOp: 'clear', storeOp: 'store',
```

後ろ2行は`beginRenderPass`のカラーアタッチメント設定の抜粋です。現在の表示用テクスチャからViewを作り、描画先へ指定します。RTVに近い役割です。`clear`で開始時に消去し、`store`で描画結果を保持します。

```javascript
pass.setPipeline(pipeline);
pass.draw(3);
pass.end();
device.queue.submit([encoder.finish()]);
```

パイプラインを設定し、3頂点を描画します。passを終了し、encoderをCommand Bufferへ確定してQueueへ投入します。コマンドリストの記録・Close・ExecuteCommandListsに近い流れです。

### 頂点とピクセルのシェーダー

```wgsl
@vertex fn vertexMain(@builtin(vertex_index) index: u32) -> VertexOutput {
output.position = vec4f(positions[index], 0.0, 1.0);
output.color = colors[index];
```

別々の箇所の抜粋です。`vertex_index`は今回のDrawではSV_VertexID相当です。頂点バッファを使わず、WGSL内の配列から位置と色を取得します。positionはクリップ空間へ直接出力し、w=1としています。

```wgsl
@builtin(position) position: vec4f,
@location(0) color: vec3f,
```

VS出力構造体のメンバーです。positionはSV_Position相当、colorはユーザー定義の補間値です。WGSLではセマンティクス名の代わりにlocation番号で対応を指定します。

```wgsl
@fragment fn fragmentMain(input: VertexOutput) -> @location(0) vec4f {
  return vec4f(input.color, 1.0);
}
```

補間された色をカラーアタッチメント0へ返します。出力のlocation(0)はSV_Target0相当です。[WGSL仕様](https://www.w3.org/TR/WGSL/)

## ブラウザとネイティブ描画の境界

このデモのHTML・JavaScript・WGSLはGitHub Pagesから配信され、閲覧者の端末で実行されます。PagesやActionsがGPU描画するわけではありません。

D3D12で明示するリソースステート遷移やPresentの呼び出しは、このコードにはありません。WebGPUの検証と実装、ブラウザの表示処理に任せる部分です。`queue.onSubmittedWorkDone()`は投入済みGPU作業の完了を待ちますが、モニターへの表示完了を保証するものではありません。[WebGPUのAPI概要](https://developer.mozilla.org/en-US/docs/Web/API/WebGPU_API)

## 期待される結果

実行後にグラデーションの三角形が表示され、状態欄が「描画完了」になります。再実行でも同じ結果になります。GPU情報の機種名が取得できなくても描画は可能です。

## Limitation

WebGPUを利用できるブラウザ・GPU環境と、HTTPSまたはlocalhostでの表示が必要です。内部描画解像度は960×540で固定し、連続描画や画面サイズに合わせた解像度変更は行いません。
