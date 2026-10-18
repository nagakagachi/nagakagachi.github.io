---
title: "Test05-Reversed ZとDepth Buffer"
layout: "experiment"
outputs: ["HTML", "Source"]
start_label: "開始"
description: "2つのCubeの前後関係とReversed Zの深度テストを確認するTypeScriptのWebGPU実験"
---

学習用にAgentCodingで生成したデモです

カメラの前で2つのCubeが回転・移動し、前後関係が入れ替わります。NDC Zが0〜1のReversed Zで深度テストを行います。

このTestからTypeScriptを導入しました。ビルド時に型チェックを行い、ブラウザで実行するJavaScriptを生成しています。

## 操作

「開始」で描画、「停止」で静止、「再開」で続きから描画します。別タブへ移ると停止します。

- **Depth有効**：奥の面が手前の面に隠れます。無効にすると、後から描いた面が上書きします。
- **深度を表示**：Depth Bufferの値をそのままグレースケールで表示します。近いほど白く、遠いほど黒く、背景はクリア値0の黒です。

深度表示にはガンマ・指数補正や距離の線形化を加えていません。Cubeも暗い灰色になります。Depth無効では深度を書かないため、深度表示も無効にします。

<!-- demo -->

## コードの解説

初期化、VB・IB、uniform、連続描画は先行Testと共通するため、今回はTypeScript、座標変換、Depth Bufferとその表示を抜粋します。コードは各Testで独立しています。DirectX 12との比較は役割の近似です。

### TypeScriptの原本と実行ファイル

```typescript
interface Demo {
  draw(time: number): void;
  dispose(): void;
}
let demo: Demo | undefined;
```

GPU初期化後の描画と解放の契約をinterfaceで表します。未初期化も型に含め、使用前に確認します。型の定義はJSへ変換すると消えます。interface自体がC++の仮想関数テーブルを生成するわけではありません。

```typescript
const canvas = element('#gpu-canvas', HTMLCanvasElement);
```

elementはこのTest内の小さな関数です。DOMを検索し、instanceofで実体を検査してから返します。型アサーションでCanvasと決めつけず、実行時にも検査します。controls.txtのチェックボックスも同様に取得し、changeイベントで同じ姿勢のまま再描画します。

```text
main.ts → TypeScriptの型チェック・JS生成 → main.js → ブラウザ
```

原本のmain.ts、WGSL、UI、解説をGitで管理します。tools/build_site.pyがOS一時領域へsiteの作業コピーを作り、tscでJSを生成した後にHugoと検証を実行します。生成JSは原本フォルダへ書き戻しません。「直接表示」とGitHubはTS原本を参照します。

### 行列の渡し方

```wgsl
output.position = object.mvp * vec4f(position, 1.0);
```

WGSLのmat4x4fと列ベクトルを掛けます。TS側のFloat32Arrayも列優先で格納し、Projection × View × Modelの順で合成します。HLSL/C++の行列規約をそのまま持ち込まず、格納順と掛け方を揃えます。

```typescript
return new Float32Array([f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, 0, -1, 0, 0, near, 0]);
```

右手の視点空間で前方が−Zの、無限遠Reversed Z射影行列です。clip.z = near、clip.w = −view.zなので、透視除算後の深度はnear / distanceです。Nearで1、無限遠で0へ近づきます。OpenGL既定の−1〜1からの変換は加えません。

```typescript
data.set(mvp);
data.set(colors[i], 16);
```

Cubeごとのuniformへ行列64バイトと色16バイトを詰めます。合計80バイトです。2つのCubeは別々のuniformとBind Groupを持つため、同じバッファをDraw間で上書きして両方が最後の値になることを避けています。

### 深度リソース

```typescript
size: [canvas.width, canvas.height], format: 'depth32float',
usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
```

Canvasと同じサイズの浮動小数点Depth Bufferです。深度テストの描画先と、後の表示パスの読み取り元の両用途を指定します。D3D12のDSVとSRVに近い用途ですが、WebGPUでは同じViewをそれぞれのパスで利用します。

```typescript
depthStencil: { format: 'depth32float', depthWriteEnabled: enabled, depthCompare: enabled ? 'greater' : 'always' },
```

Render Pipelineの設定です。有効時は大きい値、つまり近い面が通過します。無効時は比較をalways、書き込みをfalseにします。これを2つのPSOとして事前に作り、UIで選びます。

```typescript
depthStencilAttachment: { view: depthView, depthClearValue: 0.0, depthLoadOp: 'clear', depthStoreOp: 'store' },
```

Render Passへ深度Viewを渡し、最も遠い値0でクリアします。後で深度を読むためstoreを指定します。PSOのformatとアタッチメントのformatを揃えます。

### 深度をそのまま表示

```wgsl
@group(0) @binding(0) var depthTexture: texture_depth_2d;
let depth = textureLoad(depthTexture, vec2i(position.xy), 0);
return vec4f(vec3f(depth), 1.0);
```

depth.wgslから宣言とFragment処理を抜粋しています。画面上の画素座標で深度を直接読み、RGBへ同じ値を出力します。比較Samplerも線形Samplerも使いません。深度の表示用に独立したフルスクリーン描画を行い、このパスには深度アタッチメントを付けません。

## Reversed Zの設定

この実験では次をセットで使います。

| 項目 | 設定 |
|---|---|
| NDC Z | 0〜1 |
| 射影 | Near → 1、Far ∞ → 0 |
| フォーマット | depth32float |
| 比較 | greater |
| クリア | 0 |

比較とクリアだけを反転するのではなく、射影も対応させます。カメラは(0, 1.6, 6)から原点を向き、視野角60°、Near 1です。遠方の精度差ではなく、遮蔽と設定の対応を確認するための小さなシーンです。

## 深度の読み書き

Cubeを描画したRender Passを終了し、その後にDepth Bufferを読む表示パスを記録します。書き込み先と読み取り元として同じ深度リソースを同じパスに置きません。WebGPUが必要な遷移と同期を扱うため、明示的なResourceBarrierは記述しません。

Depth無効では、Cube間だけでなく同じCubeの面同士にも奥行き比較が働きません。カリングは両モードともbackのままです。頂点色の代わりに面ごとの固定明度を使い、ライティングは行っていません。

## 期待される結果

青と黄のCubeが左右・前後へ移動しながら回転します。片方が手前を通った後、時間が進むともう片方が手前に来ます。重なりで停止し、Depthの有効・無効を切り替えると、奥にあるCubeが手前を上書きする違いを確認できます。

深度表示では背景が黒、Cubeが灰色になります。カラー画像の明暗とは無関係で、各面のカメラからの奥行きを示します。停止中でも表示を切り替えられます。

## 制約

WebGPU対応環境とHTTPSまたはlocalhostが必要です。CanvasとDepth Bufferは960×540固定です。MSAA、リサイズ、カメラ操作、深度精度の比較、線形距離表示、表示補正は扱いません。行列処理はこのTest内に実装し、外部の行列ライブラリや画像素材は追加していません。

参考：[WebGPU Reversed Zサンプル](https://webgpu.github.io/webgpu-samples/samples/reversedZ/)
