---
title: "Test02"
layout: "experiment"
outputs: ["HTML", "Source"]
description: "Vertex BufferとIndex Bufferで4頂点の四角形を描画するWebGPUの実験"
---

学習用にAgentCodingで生成したデモです

位置と色を持つ4頂点と6インデックスから、2枚の三角形で四角形を描画します。頂点データはWGSL内の配列ではなく、JavaScriptで用意してGPUBufferへ転送します。

## 操作

「実行」で描画します。「再実行」で同じデータをもう一度描画します。アニメーションはありません。

<!-- demo -->

## コードの解説

[Test00](../test00/)の初期化・パイプライン・基本の描画と、[Test01](../test01/)のバッファ更新の説明は省き、頂点入力とIndexed Drawを抜粋します。DirectX 12との比較は役割の対応です。実装は他のTestに依存しません。

### 頂点とインデックス

```javascript
-0.45, 0.65, 0.85, 0.85, 0.95,
const indices = new Uint16Array([0, 1, 2, 0, 2, 3]);
```

前の行はFloat32Arrayで定義した1頂点の抜粋です。XYの2成分とRGBの3成分で20バイト。4頂点を時計回りに並べ、インデックスで2枚の三角形を指定します。四角形の対角線の両側で頂点0と2を共有します。Uint16ArrayはCPU側の16ビット符号なし整数配列です。

### バッファの用途

```javascript
vertexBuffer = device.createBuffer({ size: vertices.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
indexBuffer = device.createBuffer({ size: indices.byteLength, usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST });
```

VBは80バイト、IBは12バイトです。頂点・インデックス用途と、queue.writeBufferで書き込む用途を指定します。byteLengthは要素数ではなくバイト数です。

### 頂点レイアウト

```javascript
arrayStride: 20,
{ shaderLocation: 0, offset: 0, format: 'float32x2' },
{ shaderLocation: 1, offset: 8, format: 'float32x3' },
```

vertexLayoutの抜粋です。strideはD3D12_VERTEX_BUFFER_VIEWのStrideInBytes、属性のoffsetとformatはInput Layoutに近い役割です。location 0がXY、location 1がRGBで、offsetの単位はバイトです。

```javascript
vertex: { module: shader, entryPoint: 'vertexMain', buffers: [vertexLayout] },
```

パイプラインに頂点入力のレイアウトを登録します。buffersの0番目と、setVertexBufferのスロット0を対応させます。

### WGSLの頂点入力

```wgsl
@vertex fn vertexMain(@location(0) position: vec2f, @location(1) color: vec3f) -> VertexOutput {
```

Input LayoutのshaderLocationとWGSLのlocationが一致している必要があります。HLSLのPOSITIONやCOLORという名前ではなく、番号で対応します。頂点バッファから渡されたpositionとcolorを、クリップ位置と補間値として返します。

### Indexed Draw

```javascript
pass.setVertexBuffer(0, vertexBuffer);
pass.setIndexBuffer(indexBuffer, 'uint16');
pass.drawIndexed(6);
```

IASetVertexBuffers、IASetIndexBuffer、DrawIndexedInstancedに近い流れです。uint16はDXGI_FORMAT_R16_UINTに近く、CPU側のUint16Arrayと一致させます。6は頂点数ではなくインデックス数です。[setIndexBufferの説明](https://developer.mozilla.org/en-US/docs/Web/API/GPURenderPassEncoder/setIndexBuffer)

## 頂点レイアウトとメモリ配置

VBにはXYRGBを交互に配置します。入力属性のfloat32x3は12バイトとして読み出せるので、Test01のuniformにおけるvec4fの16バイト配置を、そのまま頂点入力へ適用する必要はありません。WGSLのvec3fを入力するために、頂点色を4成分へ拡張する必要もありません。

同じ頂点を複数の三角形で使うとき、Index Bufferで頂点を共有できます。位置だけが一致しても色・UV・法線などが異なる場合は、別の頂点として扱います。

## ワインディングと表示形状

このデモはcullModeをnoneにしています。frontFaceの向きとカリングを学ぶ実験ではないため、裏面の除去は行いません。深度テストもありません。

位置は直接クリップ空間へ渡します。Canvasが960×540なので、XYに同じ数値幅を使っても画面上の長さは一致しません。今回はXとYの範囲を別々に選び、長方形を描いています。

## 期待される結果

4隅の色が補間された四角形が表示されます。2枚の三角形は共有頂点で接続され、背景が見える隙間はありません。色の補間勾配は三角形単位なので、対角線で勾配が変わる場合があります。

## Limitation

WebGPU対応環境とHTTPSまたはlocalhostが必要です。960×540固定、深度・MSAA・リサイズ・回転は扱いません。GPU機種名が空でも描画できます。
