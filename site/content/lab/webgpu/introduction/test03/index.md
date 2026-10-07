---
title: "Test03"
layout: "experiment"
outputs: ["HTML", "Source"]
description: "オフスクリーン描画と3×3ガウスブラーを組み合わせるWebGPUの2パス実験"
---

学習用にAgentCodingで生成したデモです

Pass 1で四角形をオフスクリーンテクスチャへ描き、Pass 2で3×3のガウス近似カーネルを適用してCanvasへ表示します。効果を見やすくするため、オフスクリーンは240×135、Canvasは960×540です。

## 操作

「実行」で2パスを描画します。描画後の「ブラー有効」を切り替えると、同じシーンをブラーあり・なしで再描画します。チェックボックスはこのTestのcontrols.txtに定義し、main.jsがidのgpu-blurで取得します。連続描画はありません。

<!-- demo -->

## コードの解説

[Test02](../test02/)のVB・IB・Indexed Drawと、[Test01](../test01/)のuniformの扱いは省き、描画先テクスチャと後処理を抜粋します。各APIのDirectX 12との比較は役割の近似です。このTestは独立した実装です。

### オフスクリーンの作成

```javascript
size: [240, 135], format: 'rgba8unorm',
usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
```

createTextureの設定です。描画先として使う用途と、シェーダーで読む用途を両方指定します。D3D12でRTVとSRVを作って利用するテクスチャに近い役割です。Pass 1のパイプラインの出力フォーマットもrgba8unormに揃えます。[createTextureの説明](https://developer.mozilla.org/en-US/docs/Web/API/GPUDevice/createTexture)

```javascript
offscreenView = offscreen.createView();
```

このViewをPass 1の描画先と、Pass 2のBind Groupのテクスチャリソースに使います。ViewにRTV/SRVという別の型名を指定するのではなく、使用箇所によって役割が決まります。

### Samplerとバインド

```javascript
minFilter: 'linear', magFilter: 'linear',
addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge',
```

Samplerの設定です。拡大・縮小時は線形フィルタ、UVが端を超えたら端の画素へクランプします。対辺の画素が混ざるwrapは使いません。

```wgsl
@group(0) @binding(0) var sourceTexture: texture_2d<f32>;
@group(0) @binding(1) var sourceSampler: sampler;
```

HLSLのTexture2DとSamplerStateに近い宣言です。JavaScriptのBind Group Layoutで、binding 0にfloatのtexture、1にfiltering sampler、2にブラー切り替え用uniformを設定します。可視ステージはFRAGMENTです。

### 2つのパスを記録

```javascript
scene.drawIndexed(6);
scene.end();
const post = encoder.beginRenderPass({ colorAttachments: [{
```

Pass 1を終了してから同じencoderでPass 2を開始します。最初のアタッチメントはoffscreenView、次はCanvasの現在のテクスチャViewです。PSOもシーン用と後処理用で切り替えます。

```javascript
post.setPipeline(postPipeline);
post.setBindGroup(0, postGroup);
post.draw(3);
```

Pass 2は頂点バッファなしのフルスクリーン三角形です。画面全体を覆う3頂点をWGSL内で生成し、オフスクリーンのView・Sampler・uniformをBind Groupで渡します。両パスを1つのCommand Bufferとしてsubmitします。

### UVの生成

```wgsl
output.uv = vec2f(p[index].x * 0.5 + 0.5, 0.5 - p[index].y * 0.5);
```

クリップ空間のXYをUVへ変換します。画面上端がUVのv=0になるようYを反転します。三角形の頂点は画面外にもありますが、ラスタライズされる画面内のUVは0～1です。

### 1テクセルの幅

```wgsl
let texel = 1.0 / vec2f(textureDimensions(sourceTexture));
```

サンプリング元の幅・高さからUV単位の1テクセル幅を求めます。Canvasの960×540ではなく、オフスクリーンの240×135を基準にする点に注意します。

### 9サンプルの合成

```wgsl
let weights = array<f32, 3>(1.0, 2.0, 1.0);
let weight = weights[u32(x + 1)] * weights[u32(y + 1)];
color += textureSampleLevel(sourceTexture, sourceSampler, input.uv + offset, 0.0) * weight;
```

x・yをそれぞれ-1～1で走査する二重ループ内の抜粋です。横と縦の重みを掛け、9点の色を加算します。HLSLのSampleLevelに近いtextureSampleLevelで、LOD 0を明示します。切り替え条件やループ内で暗黙LODの微分に頼らない実装です。

```wgsl
return color / 16.0;
```

重みの合計が16なので正規化します。ブラー無効時は中心の1サンプルをそのまま返します。

## パス間の読み書き

Pass 1ではテクスチャへ書き、storeOpをstoreにして結果を保持します。Pass 2ではその結果を読み、別のCanvasテクスチャへ書きます。同じパスで同じサブリソースを描画先とサンプリング元にしません。

D3D12のRT→Shader Resource遷移に相当する明示的なResourceBarrierは記述しません。WebGPUが使用状況を検証し、実装が必要な同期・遷移を扱います。ただし用途の指定とパスの分離はアプリ側の責任です。

## 3×3ガウス近似

```text
1  2  1
2  4  2  × 1/16
1  2  1
```

固定の小さなカーネルです。ガウス分布に近い重みを持ちますが、任意のsigmaを指定する実装ではありません。横・縦に分ける最適化はせず、1つの後処理パスで9サンプル読みます。

240×135を4倍に表示するため、1テクセルのオフセットが画面上の4ピクセル分になり、輪郭の変化を見つけやすくなります。ブラー無効でもSamplerの線形補間は残ります。比較は同じ拡大条件で、9点合成の有無だけを変えます。

## 期待される結果

四角形の輪郭が背景へにじみます。ブラー無効にすると輪郭が鋭くなり、有効に戻すと再びぼけます。色・向き・位置は変わりません。各切り替えで両パスを再実行します。

## Limitation

WebGPU対応環境とHTTPSまたはlocalhostが必要です。固定解像度・不透明な出力で、深度・MSAA・リサイズ・分離型ブラーは扱いません。画像ファイルや実験別サムネイルは追加していません。
