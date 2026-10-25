---
title: "Test06-Computeで生成したテクスチャ"
date: "2026-10-18T11:49:49+09:00"
lastmod: "2026-10-18T11:49:49+09:00"
layout: "experiment"
outputs: ["HTML", "Source"]
start_label: "開始"
description: "Compute ShaderでSDFの模様を1回生成し、UVとSamplerでCubeへ貼るWebGPU実験"
---

学習用にAgentCodingで生成したデモです

初期化時にCompute Shaderで模様を生成し、回転するCubeの各面へ貼ります。角丸の枠、上向きの矢印、右下の小さな円を2Dの距離関数で描き、上下・左右が分かる図柄にしています。保存するのは距離ではなく通常のRGBA画像です。

TypeScript、Reversed Z、行列の扱いは[Test05](../test05/)を引き継ぎます。このTestも他のTestへ依存しない独立した実装で、画像ファイルや追加ライブラリは使いません。

## 操作

「開始」で初期化と描画を行い、「停止」でCubeの回転を止めます。「再開」で続きから回転します。別タブへ移ると停止します。

- **フィルタ**：Linear／Nearestを切り替えます。停止中も変更でき、輪郭を比較できます。
- **表示**：Cubeへの貼り付けと、生成テクスチャの平面表示を切り替えます。平面表示では画像の縦横比を1:1で保ちます。

テクスチャ生成はGPU初期化時に1回だけです。回転・フィルタ・表示の変更では再生成しません。ページを離れてGPUを解放した後は、再初期化時に生成し直します。

<!-- demo -->

## コードの解説

ComputeのDispatchとStorage Textureは[Test04](../test04/)、3D描画とReversed Zは[Test05](../test05/)を参照してください。今回は生成した画像を描画で読むためのUV、Texture、Samplerとバインドを中心に抜粋します。DirectX 12との対応は役割の近似です。

### 生成先と読み取り元を兼ねるテクスチャ

```typescript
size: [256, 256], format: 'rgba8unorm', mipLevelCount: 1,
usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING,
```

無圧縮RGBA各8ビット、約256 KiBのテクスチャです。Computeの書き込み先と、Fragment Shaderの読み取り元の用途を両方指定します。コピー先やCPUへのReadbackは用意しません。

```wgsl
@group(0) @binding(0) var outputTexture: texture_storage_2d<rgba8unorm, write>;
```

生成側の宣言です。D3D12のUAVに近い用途で、textureStoreで色を書きます。生成用のBind GroupはCompute Pipelineに属するので、後で出てくる描画用のgroup番号とは独立しています。

### 初期化時のDispatch

```typescript
generatePass.dispatchWorkgroups(32, 32);
generatePass.end();
device.queue.submit([generateEncoder.finish()]);
```

initialize内の抜粋です。8×8スレッドのグループを32×32個実行し、256×256画素を埋めます。draw内にはCompute PassもDispatchもありません。生成結果はGPUテクスチャに保持し、同じQueueへ後から投入する描画で読みます。

### 画素中心を図柄の座標にする

```wgsl
let uv = (vec2f(id.xy) + 0.5) / vec2f(size);
let p = uv * 2.0 - 1.0;
```

画素中心のUVを求め、中心が(0,0)、範囲がおよそ−1〜1の座標へ変換します。この画像座標では右が+X、下が+Yです。上向きの矢印の先端はYが負になります。

```wgsl
let arrow = min(shaft, min(left, right)) - 0.055;
```

3本の線分までの距離の最小値を取り、線幅を差し引いて矢印を作ります。線分の両端は丸くなります。枠は角丸Boxの距離の絶対値から太さを引き、円は中心からの距離から半径を引いています。

```wgsl
return 1.0 - smoothstep(-aa, aa, distance);
```

距離0付近を滑らかな被覆率へ変換するcoverage関数です。aaは画像解像度から求めた幅です。ComputeにはFragmentの画面微分を前提とするfwidthを使わず、生成画像の画素サイズを基準にします。

```wgsl
textureStore(outputTexture, vec2i(id.xy), vec4f(color, 1.0));
```

被覆率で配色を合成した結果を保存します。SDFそのものは保存しないので、描画時に拡大しても距離関数を再評価するわけではありません。

### 頂点にUVを追加

```typescript
{ shaderLocation: 0, offset: 0, format: 'float32x3' },
{ shaderLocation: 1, offset: 12, format: 'float32x2' },
```

Vertex Bufferは位置XYZとUVの計5個のfloat、stride 20バイトです。面ごとに4頂点を持ち、各面へ0〜1のUVを割り当てます。位置が同じ角でも、面ごとにUVが異なるため頂点を共有しません。合計24頂点・36インデックスです。

```wgsl
output.uv = uv;
```

VSからFSへUVを渡す部分です。location(0)の補間値として受け渡し、既定の透視補正補間を使います。各面の下側の頂点はv=1、上側はv=0です。

### TextureとSamplerをバインド

```wgsl
@group(1) @binding(0) var colorTexture: texture_2d<f32>;
@group(1) @binding(1) var colorSampler: sampler;
```

描画側では同じテクスチャを読み取り専用のtexture_2dとして宣言します。HLSLのTexture2DとSamplerStateに近い役割です。uniform行列はgroup 0、TextureとSamplerはgroup 1へ分けています。

```typescript
{ binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
{ binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
```

textureLayoutを作るentriesの抜粋です。WGSLのbinding 0・1に対応するリソースの種類と、参照するステージを宣言します。ここではまだ実体を渡していません。sampleTypeのfloatは、rgba8unormを浮動小数点値として読む指定です。

```typescript
const layout = device.createPipelineLayout({ bindGroupLayouts: [objectLayout, textureLayout] });
```

配列の添字がWGSLのgroup番号です。objectLayoutはgroup 0、textureLayoutはgroup 1になります。このlayoutをRender Pipelineへ渡し、PSOが要求するバインド構成を決めます。D3D12のRoot Signatureに近い役割ですが、要素がそのままRoot Parameterへ一対一対応するわけではありません。

```typescript
const textureView = texture.createView();
{ binding: 0, resource: textureView }, { binding: 1, resource: sampler },
```

Viewの作成と、createBindGroupのentriesを別々に抜粋しています。textureLayoutという型・配置の契約に対し、ここで実際のTexture ViewとSamplerを登録します。画像データをコピーする処理ではありません。同じtextureViewと異なるSamplerを組み合わせ、Nearest用とLinear用のBind Groupを作ります。

```typescript
minFilter: filter, magFilter: filter,
addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge',
```

filterにはnearestまたはlinearが入ります。2種類のSamplerとBind Groupを初期化時に用意し、UIで選びます。どちらもfloatテクスチャ用のfiltering Sampler Layoutで扱えます。端を越えたUVは端へクランプします。

```typescript
const group = textureGroups.get(filtering.value);
pass.setBindGroup(0, objectGroup);
pass.setBindGroup(1, group);
```

描画処理から抜粋しています。実装ではgroupの取得後に存在確認を挟みます。UIの選択値でBind Groupを取り出し、group 0へ行列、group 1へTextureとSamplerの組を設定してからdrawIndexedを呼びます。setBindGroupの第1引数はbinding番号ではなくgroup番号です。フィルタ変更では既存の組を選び直すだけで、画像の生成や転送は行いません。

```wgsl
return textureSample(colorTexture, colorSampler, input.uv);
```

FSでUVに対応する色を取得し、そのまま出力します。今回は照明や面ごとの明度を掛けません。rgba8unormなので、テクスチャ読み取りに自動sRGBデコードは入りません。

## Computeから描画への受け渡し

```text
初期化：SDFから色を計算 → rgba8unormへ書き込み
毎フレーム：保存済みの同じテクスチャを読む → Cubeへ貼る
```

Compute Passを終了してからRender Passで読みます。GPU上の同じテクスチャを使い続け、別の描画用テクスチャへコピーしません。WebGPUが用途を検証し、必要な同期・リソース遷移を扱います。毎フレームのCPUによるGPU完了待ちも不要です。

生成時は各invocationが自分の1画素だけを書き、過去の値や隣の画素を参照しません。履歴用のping-pongやworkgroup barrierは必要ありません。

## 生成時の輪郭とサンプリング

生成側のsmoothstepと描画側のLinearフィルタは別の処理です。前者は画像へ保存する輪郭を滑らかにし、後者は保存済み画像を読むときに隣接テクセルを補間します。Nearestへ変えても、生成時に付けた輪郭の中間色は残ります。

Mipは1レベルだけです。強く縮小した面や斜めの面ではちらつき・エイリアシングが出ることがあり、Linearだけで解消するものではありません。今回はMip生成と異方性フィルタは扱いません。

## 期待される結果

Cubeの各面に枠と矢印が見え、片側の円で左右も判別できます。回転を止めてフィルタを切り替えると輪郭の補間が変わります。生成テクスチャの表示では、上向きの矢印と右下の円を正面から確認できます。

## 制約

WebGPU対応環境とHTTPSまたはlocalhostが必要です。Canvasは960×540固定です。Reversed Zを使いますが深度表示は付けていません。画像ファイルのデコード、圧縮、Mip生成、照明、リサイズは扱いません。ページの初期化をやり直す場合を除き、Computeは再実行しません。
