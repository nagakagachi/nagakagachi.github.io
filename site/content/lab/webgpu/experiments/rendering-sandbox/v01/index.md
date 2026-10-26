---
title: "RenderingSandbox v01"
date: "2026-10-27"
lastmod: "2026-10-27"
layout: "sandbox"
outputs: ["HTML", "Source"]
description: "地球大気の天球・SHスカイライト・大気遠近法と、HDR出力を分離したレンダリング実験環境"
---

学習用にAgentCodingで生成したデモです

[版一覧](../) · [前の版：v00](../v00/)

地形・シャドウ・天球を組み合わせたレンダリング実験環境です。v01では地球の大気散乱と大気遠近法を追加し、線形HDRのシェーディングとトーンマッピングを別パスに分けました。

<!-- demo -->

## 操作と表示

「実行」で開始します。ビューをクリックし、WASDで前後左右、Q/Eで上下、Shiftで加速、ドラッグ・矢印キーで視点を回転します。ホイールでも前後へ移動できます。

設定はビュー横のパネルにまとめています。地形シードなどは「地形」で変更し、生成ボタンで適用します。ライトの方位角0°は+Z、90°は+X、仰角は水平からの角度です。

- 「大気遠近法」で、遠景の減衰と散乱光の有無を比較できます
- 「ポストプロセス」の露出は、HDR合成後の画面全体へ作用します
- 「SkyLight」の強度は地表の拡散環境光へ作用します
- 「診断」の法線・タイル色・シャドウ可視率で形状やカリングを確認できます。可視率は白が受光、黒が遮蔽です
- 「カリング・配置を固定」では、可視リストと地形配置を固定したままカメラを移動できます

メトリクスの「実行状況」には可視タイル数や更新状況、「構成情報」には適用中の条件とGPUリソースを表示します。

## 描画パス

| パス | 出力・役割 |
| --- | --- |
| ZPrePass | メインビューの深度を確定 |
| ShadowPass | ライト視点のShadow Mapを生成 |
| ForwardShadingPass | 直接光・SkyLight・大気遠近法と天球を、線形HDRカラーへ出力 |
| PostProcessPass | HDRカラーを読み、露出・トーンマッピング・表示色変換を適用 |

これらの前に、必要な標高キャッシュ更新、天空環境の生成・SH投影、Main/ShadowのカリングをComputeで行います。ZPrePassをShadowPassより前に置くのは、将来SSAOなどがメイン深度を参照する構成を想定しているためです。この版ではSSAOや非同期Computeは実装していません。

不透明物の描画契約は`render-passes.ts`の`OpaqueRenderable`です。今後追加するモデルも、深度用のZOnlyバリエーションとForwardバリエーションをこの契約へ登録します。背景の天球は別の`BackgroundRenderable`として扱います。

## 地形とGPUカリング

地形は[TerrainRendering00](../../terrain-rendering00/)のタイルClipmap方式を引き継いでいます。64×64セルのタイルを共有IBで描画し、VBは持ちません。標高はComputeで生成し、1024²を基本としたFP16のHeight Clipmapに保持します。

カリングはメインビューとライト視点で独立して行います。それぞれにScene Uniform・可視タイルIDリスト・Indirect引数を持ち、各視点のフラスタムと地形の保守的AABBで判定します。メインで不可視のタイルも、ライトの描画範囲にあればシャドウキャスターとして残します。

可視リストの領域予約はsubgroupで集約し、未対応環境ではworkgroup scanを使います。描画はGPU上の可視リストとIndirect引数を参照し、CPUへ可視数を読み戻して描画を制御する構成にはしていません。メトリクス用の読み戻しだけを非同期で行います。

## 深度プリパスとシャドウマップ

### ZOnlyバリエーション

```wgsl
return terrainVertex(id, instance).clip;
```

`terrain-geometry.wgsl`にある位置・標高・LOD接続の計算を、ZOnlyとForwardで共有します。ZOnlyは位置だけを出力し、法線の取得やPSを持ちません。メインとライトでは同じZOnly Pipelineを使い、視点のUniformと可視リストを切り替えます。

```ts
depthStencil: { format: 'depth32float', depthWriteEnabled: false, depthCompare: 'equal' }
```

ForwardはZPrePassの深度をReadOnlyで参照し、Equal比較で描画します。頂点位置の計算を一致させ、両バリエーションの位置出力に`invariant`を付けています。不透明PSにはdiscard/clip・深度出力・Storage書き込みを置きません。

### Directional Shadow Map

2048²のShadow Mapを1枚使います。メイン・シャドウともNDC Z=0〜1のReversed Zで、Shadow Mapはclear=0、書き込み比較はgreater、参照比較はgreater-equalです。

深度バイアスは受け手の比較用Zへ加算し、法線バイアスは参照用のワールド座標を法線方向へ移動します。PCFは1・3×3・5×5を選択でき、各tapにもハードウェアの線形比較フィルタが掛かります。

投影中心を光源平面のテクセルへスナップし、深度範囲には候補地形を保守的に含めます。投影半幅の初期値は2 kmで、ライト視点の4 km四方を覆います。参照範囲外は、このShadow Mapでは遮蔽されないものとして扱います。

## 直接光とスカイライト

### リニアワークフローと材質

```wgsl
let skyDiffuse = albedo * evaluateSkySH(skySH, n) * lighting.skyDiffuse.w;
var linearHdr = albedo * direct + skyDiffuse;
```

アルベドはリニア反射率、直接光とSkyLightは線形の光量として計算します。現在のBRDFは正規化Lambertの拡散反射のみで、GGXスペキュラや金属材質は実装していません。

直接光にはLambertの1/π、太陽から地表までの大気透過率、法線とライト方向の内積、Shadow Mapの可視率を適用します。SkyLightは法線方向に応じた天空からの拡散光です。影の中だけでなく全体へ加算し、直接光のShadow Mapによる可視率は掛けません。

### Octahedral Mapと1次SH

```wgsl
textureStore(skyMap, vec2i(id.xy), vec4f(skyRadiance(direction), 1.0));
```

背景と同じ天空関数を、256²・`rgba16float`のOctahedral Mapへ描画します。Yを上方向とし、下半球も含む全方向の線形放射輝度を保持します。キューブマップは使いません。

```wgsl
let kernel = select(0.6666666667, 1.0, c == 0u);
result.coefficients[c] = vec4f(sums[c * 64u].rgb * normalization * kernel, 0.0);
```

1次SHはl=0,1の2バンド・4係数で、基底の順序は[定数, X, Y, Z]です。Octahedral復号のJacobian `1/|v|³`で立体角を補正し、総立体角を4πへ正規化して投影します。

Lambertのclamped cosine畳み込みとBRDFの1/πを係数へ含めるため、帯域ごとの係数は0次が1、1次が2/3です。投影はworkgroup内で局所和を作り、別のdispatchで4係数へ集約します。グローバルAtomicや係数のCPU読み戻しは使いません。

MapとSHは初回・太陽方向変更・観測高度変更時に更新します。水平移動・カメラ回転・露出・SkyLight強度の変更では再投影しません。SH評価の負値は0に抑えます。

## 天球と大気散乱

```wgsl
let linearHdr = skyRadiance(ray);
return vec4f(linearHdr, 1.0);
```

背景はカメラからのピクセルレイで天空を直接評価します。画面の描画にOctahedral Mapを参照する構成ではなく、環境光の生成と背景の描画で同じ天空モデルを共有しています。

`atmosphere.wgsl`は地球半径6,371 km、大気上端100 kmの球殻を扱います。指数密度のRayleigh散乱とMie散乱を単一散乱として数値積分します。密度のスケールハイトは8 kmと1.2 km、Mieの位相関数はHenyey–Greensteinのg=0.8です。視線16区間・太陽方向8区間で評価し、地球に遮られた太陽光は0にします。

背景はForwardShadingPass内で不透明物の後に描画します。全画面三角形をReversed Zの最遠方Z=0へ置き、ReadOnly深度とのgreater-equal比較で背景画素だけを処理します。天球も地形と同じ線形HDRターゲットへ出力します。

地形のローカルY=0は海抜2,000 mに対応させ、観測高度の下限を2 mとしています。負の標高を持つ地形も扱うための基準高度です。地形は平面ローカル座標、大気は球殻とする近似です。下半球には灰色の地表反射を含め、太陽円盤は描画しません。

## 大気遠近法フォグ

```wgsl
let aerial = integrateAtmosphere(origin, relative / distance, lighting.light.xyz, distance);
linearHdr = linearHdr * aerial.transmittance + aerial.scattering;
```

視点から地表までの有限距離について、大気の透過率と散乱光を求めます。地表のシェーディング結果を透過率で減衰させ、視線上で加わる散乱光を足します。遠景のコントラストや色が大気によって変化する処理です。

天球には大気上端まで、地形にはその画素までの距離を使い、同じ大気積分関数で評価します。この合成はForwardShadingPass内のシーンリニアHDRで行い、結果をHDRターゲットへ書き込みます。地表付近の濃いHeight Fogは追加していません。

## トーンマッピング

```wgsl
let linearHdr = textureLoad(sceneHdr, vec2i(pixel.xy), 0).rgb;
let exposed = max(linearHdr * post.exposure, vec3f(0.0));
let mapped = acesFilmic(exposed);
return vec4f(linearToSrgb(mapped), 1.0);
```

`post-process.wgsl`の抜粋です。独立したPostProcessPassがシーンHDRカラーを読み、露出 → ACES Filmic Tonemapping → sRGB変換の順でCanvasへ出力します。トーンマッピングはHDRの輝度範囲を表示用の範囲へ写像する処理で、大気による減衰・散乱とは別の段階です。

ForwardShadingPassは`rgba16float`へ線形HDRを出力し、露出・トーンマッピング・sRGB変換を行いません。直接光・SkyLight・大気の合成途中で1を超える値を保持します。Octahedral MapとSHも表示変換前の線形値のままです。

曲線はNarkowiczのACES Filmicフィット近似です。厳密なACESの色空間変換・表示変換一式ではなく、RGB各成分へ適用する簡略な曲線です。

現在はCanvasの非sRGB形式へ出力するため、最終シェーダーでsRGB変換を一度だけ行います。法線・タイル色・シャドウ可視率の診断表示は大気遠近法を迂回しますが、表示経路は同じPostProcessPassです。

## GPUリソース

初期設定での主なリソースです。画面解像度は960×540です。

| リソース | 形式・容量 |
| --- | --- |
| Height Clipmap | 1024²×7段、FP16、14 MiB |
| タイル描画用・ワイヤーフレーム用IB | uint16、約96.5 KiB、VBなし |
| Main/Shadowの視点別バッファ | 各480 B Uniform、6,400 B可視リスト、20 B Indirect引数 |
| Shadow Map | 2048²、depth32float、16 MiB |
| メイン深度 | depth32float、約1.98 MiB |
| シーンHDRカラー | rgba16float、約3.96 MiB |
| 天空Octahedral Map | 256²、rgba16float、512 KiB |
| SH投影用局所和・最終係数 | 64 KiB・64 B |

## 現在の制約

天空と大気遠近法は直接積分の簡略モデルです。事前計算LUTによる高速化、多重散乱、オゾン吸収、地形による体積影は未実装です。SHは観測点の高度を代表値とし、シーン全体へ適用します。局所AO、天空の遮蔽、GIは扱いません。

Shadow Mapは1枚で、カスケードや接触影、シャドウ専用LODはありません。MainとShadowで同じ候補タイル・標高キャッシュを使い、現在の地形配置範囲外のキャスターは描画しません。広い投影範囲・低い太陽高度・粗い地形LODでは、影の解像度とバイアスの限界があります。

v00とv01は実行ソースをそれぞれのフォルダで所有しています。TerrainRendering00や保存済みの版を、別の版の開発で変更しない構成です。

## 参考

大気中の透過率と単一散乱の基礎式は[Brunetonの大気散乱モデルの解説](https://ebruneton.github.io/precomputed_atmospheric_scattering/atmosphere/functions.glsl.html)を参照しています。本実装は直接積分の簡略モデルで、同モデルの事前計算LUTや多重散乱を実装したものではありません。

トーンマッピングには[NarkowiczのACES Filmic Tone Mapping Curve](https://knarkowicz.wordpress.com/2016/01/06/aces-filmic-tone-mapping-curve/)のCC0公開フィットを使用しています。
