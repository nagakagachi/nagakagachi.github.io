---
title: "RenderingSandbox v01"
date: "2026-10-27"
lastmod: "2026-10-27"
layout: "sandbox"
outputs: ["HTML", "Source"]
description: "地形・大気散乱・SHスカイライトを使った、PreExposure対応のHDRレンダリング実験環境"
---

学習用にAgentCodingで生成したデモです

[版一覧](../) · [前の版：v00](../v00/)

地形・シャドウ・天球を組み合わせたHDRレンダリングの実験環境です。地球の大気散乱、2次SHによるスカイライト、大気遠近法を扱い、PreExposureを適用したHDRカラーを最後にトーンマッピングして表示します。

<!-- demo -->

## 操作と表示

「実行」で開始します。ビューをクリックし、WASDで前後左右、Q/Eで上下、Shiftで加速、ドラッグ・矢印キーで視点を回転します。ホイールでも前後へ移動できます。

設定はビュー横のパネルにまとめています。横並びでは実行ボタンと3Dビューを合わせた高さを上限としてパネル内をスクロールできます。狭い画面ではビュー下へ移り、設定欄の高さを制限します。地形シードなどは「地形」で変更し、生成ボタンで適用します。ライトの方位角0°は+Z、90°は+X、仰角は水平からの角度です。

- 「大気遠近法」で、遠景の減衰と散乱光の有無を比較できます
- 「カメラ」の露出 EV100は−10〜15で調整できます。EVが1増えると光量は半分になります。垂直画角は30〜110°で変更できます
- 「地形」のアルベドを固定値にすると、RGB各成分のリニア反射率を調整できます
- 「ライト・シャドウ」の直接光をOFFにすると、天空を維持したまま地形への直射光だけを無効にできます
- 「SkyLight」の強度は地表の拡散環境光へ作用します
- 「診断」のSky Octahedral MapをONにすると、SkyLightの入力テクスチャをビュー左上へ表示します
- 「診断」のHeight Clipmap色分けとHeightMapグリッドで、標高キャッシュの参照段と解像度を確認できます
- 「診断」の法線・タイル色・シャドウ可視率で形状やカリングを確認できます。可視率は白が受光、黒が遮蔽です
- 「カリング・配置を固定」では、可視リストと地形配置を固定したままカメラを移動できます

メトリクスの「実行状況」には可視タイル数や更新状況、「構成情報」には適用中の条件とGPUリソースを表示します。

## 描画パス

| パス | 出力・役割 |
| --- | --- |
| ZPrePass | メインビューの深度を確定 |
| ShadowPass | ライト視点のShadow Mapを生成 |
| ForwardShadingPass | 直接光・SkyLight・大気遠近法と天球を、PreExposure済みの線形HDRへ出力 |
| PostProcessPass | HDRカラーを読み、トーンマッピング・表示色変換を適用 |

デバッグ表示がONの場合だけ、ForwardShadingPassとPostProcessPassの間にSkyMapDebugPassを発行します。

これらの前に、必要な標高キャッシュ更新、天空環境の生成・SH投影、Main/ShadowのカリングをComputeで行います。ZPrePassをShadowPassより前に置くのは、将来SSAOなどがメイン深度を参照する構成を想定しているためです。この版ではSSAOや非同期Computeは実装していません。

不透明物の描画契約は`render-passes.ts`の`OpaqueRenderable`です。今後追加するモデルも、深度用のZOnlyバリエーションとForwardバリエーションをこの契約へ登録します。背景の天球は別の`BackgroundRenderable`として扱います。

## 地形とGPUカリング

地形は[TerrainRendering00](../../terrain-rendering00/)のタイルClipmap方式を引き継いでいます。64×64セルのタイルを共有IBで描画し、VBは持ちません。標高はComputeで生成し、1024²を基本としたFP16のHeight Clipmapに保持します。

カリングはメインビューとライト視点で独立して行います。それぞれにScene Uniform・可視タイルIDリスト・Indirect引数を持ち、各視点のフラスタムと地形の保守的AABBで判定します。メインで不可視のタイルも、ライトの描画範囲にあればシャドウキャスターとして残します。

可視リストの領域予約はsubgroupで集約し、未対応環境ではworkgroup scanを使います。描画はGPU上の可視リストとIndirect引数を参照し、CPUへ可視数を読み戻して描画を制御する構成にはしていません。メトリクス用の読み戻しだけを非同期で行います。

### セルスナップと三角形分割の安定性

共有タイルIBの対角線はセルごとに交互となるため、各LODは2セル単位でスナップします。1セル移動で同じ世界セルの対角線が反転する現象を防ぎます。接続帯は外周8行を使い、同じ粗格子点へ集約する頂点に共通の変形・標高混合率を与えます。通常部の格子と三角形分割は固定されますが、LOD接続帯の切り替わりによる形状変化は残ります。

### Height Clipmapの色分け

「診断」のHeight Clipmap色分けで、描画に参照している標高キャッシュの段を表示します。段0〜6は赤・橙・黄緑・緑・水色・青紫・赤紫です。メッシュLOD0と1は同じ標高段0を使うため同じ色になります。接続帯では標高と同じ重みで隣の段の色へ補間します。標高窓全体の範囲ではなく、地形描画がどの段を参照しているかの可視化です。

照明・アルベド・大気遠近法は適用せず、カメラ露出とトーンマッピングは共通の経路を通します。この表示は法線・タイル色・シャドウ可視率より優先されます。ワイヤーフレームは重ねられます。

### HeightMapのテクセルグリッド

「診断」のHeightMapグリッドで、各標高段の16×16テクセルを1マスとした世界XZ平面上の格子を表示します。段0〜6の格子間隔は16・32・64・128・256・512・1024 mです。Height Clipmap色分けと併用でき、単独ではグレー地に格子を表示します。接続帯は参照する2段の格子を標高と同じ重みで混合します。ワールド原点に固定するため、トロイダル更新で格子の位相は動きません。線は画面上の微分でアンチエイリアスし、細かくなりすぎる遠方では減衰させます。メッシュのワイヤーフレームとは異なり、標高データ側の解像度を示します。

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

### HDRレンダリングと材質

```wgsl
let skyDiffuse = albedo * evaluateSkySH(skySH, n) * lighting.skyDiffuse.w;
var linearHdr = albedo * direct + skyDiffuse;
```

アルベドはリニア反射率として扱い、直接光とSkyLightの照明結果を線形のHDRカラーとして加算します。現在のBRDFは正規化Lambertの拡散反射のみで、GGXスペキュラや金属材質は実装していません。

直接光にはLambertの1/π、太陽から地表までの大気透過率、法線とライト方向の内積、Shadow Mapの可視率を適用します。SkyLightは法線方向に応じた天空からの拡散光です。影の中だけでなく全体へ加算し、直接光のShadow Mapによる可視率は掛けません。

### 白色アルベドでの確認

「地形」のアルベドを「固定値」に切り替えると、R・G・Bそれぞれのリニア反射率を0〜1で変更できます。(1, 1, 1)は白色、(0, 0, 0)は黒色のLambert面です。sRGBの色コードではなく、照明計算に直接使う値です。既定は従来の標高に応じた0.16〜0.94のグレーです。

SkyLightだけを確認する場合は、固定値RGB=(1, 1, 1)、直接光OFF、SkyLight強度1、大気遠近法OFFとし、法線・タイル色・シャドウ可視率・ワイヤーフレームの診断表示もOFFにします。Sky Octahedral MapをONにすると、同じ露出・トーンマッピングを通した入力天空を確認できます。直接光OFFは地形への直射光だけを無効にし、天空の生成には影響しません。

白色Lambert面の出力は `1/π × ∫ L(ω) max(n·ω, 0) dω` で、半球の天空放射輝度をコサイン加重した値です。空の特定の画素と一致する条件ではありません。一様な空ならアルベド1・SkyLight強度1の面と入力天空が一致しますが、この空は方向によって明るさが異なり、2次SHによる近似誤差もあります。

### Octahedral Mapと2次SH

```wgsl
textureStore(skyMap, vec2i(id.xy), vec4f(skyRadiance(direction), 1.0));
```

背景と同じ天空関数を、256²・`rgba16float`のOctahedral Mapへ描画します。ワールドはY-upのまま、下半球も含む全方向の線形放射輝度を保持します。マッピングは+Zを中央の極とし、XYへ展開する方式です。キューブマップは使いません。

```wgsl
let kernel = select(select(0.25, 0.6666666667, c < 4u), 1.0, c == 0u);
result.coefficients[c] = vec4f(sums[c * 64u].rgb * normalization * kernel, 0.0);
```

2次SHはl=0,1,2の3バンド・9係数です。基底の順序は[定数, X, Y, Z, XY, YZ, 3Y²−1, XZ, X²−Z²]で、各項に正規直交基底の係数を掛けます。Octahedral復号のJacobian `1/|v|³`で立体角を補正し、総立体角を4πへ正規化して投影します。

Lambertのclamped cosine畳み込みとBRDFの1/πを係数へ含めるため、帯域ごとの係数は0次が1、1次が2/3、2次が1/4です。投影はworkgroup内で局所和を作り、別のdispatchで9係数へ集約します。グローバルAtomicや係数のCPU読み戻しは使いません。

1次の打切りで失われていた法線方向による差を、2次の項まで含めて保持します。天空の全テクセルを使うcosine積分との比較で確認しています。

MapとSHは初回・太陽方向変更・観測高度変更時に更新します。水平移動・カメラ回転・露出・SkyLight強度の変更では再投影しません。SH評価の負値は0に抑えます。

## 天球と大気散乱

```wgsl
let linearHdr = skyRadiance(ray);
return vec4f(preExposeRadiance(linearHdr, cameraFrame), 1.0);
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

## カメラとPreExposure

HDRカラーの保存にPreExposureを採用しています。レンダーターゲットへ書き込む前に露出係数で値の範囲を調整し、FP16などの形式で大きな輝度を扱いやすくする手法です。スケーリング後も線形のHDRカラーとして処理します。

```wgsl
return vec4f(preExposeRadiance(linearHdr, cameraFrame), 1.0);
```

本実装では手動のEV100を `PreExposure = 2^(-EV100)` に換算し、地形と天球のPS出力時に適用します。ポストプロセスでは露出を再適用しません。SkyLight用のOctahedral MapとSHは露出に依存しない値を保持します。初期値は0 EVで、PreExposureは1です。露出補正EVとは異なり、値を上げると暗くなります。レンズ透過率の校正係数は1としています。光源強度は実測単位で校正していないため、実世界の適正EVとの対応は保証しません。自動露出は未実装です。

垂直画角は地形の投影行列と天空のピクセルレイへ同じ値を渡します。露出・画角だけの変更では、環境マップやSHを再生成しません。

## トーンマッピング

```wgsl
let preExposedHdr = max(textureLoad(sceneHdr, vec2i(pixel.xy), 0).rgb, vec3f(0.0));
let mapped = acesFilmic(preExposedHdr);
return vec4f(linearToSrgb(mapped), 1.0);
```

`post-process.wgsl`の抜粋です。独立したPostProcessPassがPreExposure済みのHDRカラーを読み、ACES FilmicによるトーンマッピングとsRGB変換を行ってCanvasへ出力します。

照明と大気の合成では1を超える値を保持し、トーンマッピングで表示用の範囲へ写像します。Octahedral MapとSHはトーンマッピング前の値を使います。

曲線はNarkowiczのACES Filmicフィット近似です。RGB各成分へ適用する簡略な曲線で、ACESの色空間変換や表示変換一式を実装したものではありません。

CanvasはsRGB色空間、書き込み先のテクスチャViewは通常のUNORM形式です。そのため、最終シェーダーでsRGBの伝達関数による符号化を一度だけ行います。法線・タイル色・シャドウ可視率の診断表示は大気遠近法を迂回しますが、表示経路は同じPostProcessPassです。

## 天空環境マップのデバッグ表示

「診断」のSky Octahedral Mapで、2次SHへの投影元となる256²のテクスチャを左上へ表示します。表示サイズは描画解像度で192×192、左と上の余白は12ピクセルです。

表示はテクスチャのV=0を上に置きます。中央が+Z、四隅が−Z、右辺中央が+X、左辺中央が−X、上辺中央が−Y、下辺中央が+Yです。Octahedralの極軸と、ワールドの鉛直軸Yは別の規約として扱います。

`SkyMapDebugPass`は環境マップを直接参照し、カメラのPreExposureを掛けてHDRターゲットへ重ねます。その後、シーンと同じトーンマッピングとsRGB変換を通します。MapやSHそのものの値は書き換えません。デバッグをOFFにしたときは、この描画パスを発行しません。

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
| SH投影用局所和・最終係数 | 144 KiB・144 B |
| 共有Camera Uniform | 露出と履歴参照用の係数、16 B |

## 現在の制約

天空と大気遠近法は直接積分の簡略モデルです。事前計算LUTによる高速化、多重散乱、オゾン吸収、地形による体積影は未実装です。SHは観測点の高度を代表値とし、シーン全体へ適用します。局所AO、天空の遮蔽、GIは扱いません。

Shadow Mapは1枚で、カスケードや接触影、シャドウ専用LODはありません。MainとShadowで同じ候補タイル・標高キャッシュを使い、現在の地形配置範囲外のキャスターは描画しません。広い投影範囲・低い太陽高度・粗い地形LODでは、影の解像度とバイアスの限界があります。

v00とv01は実行ソースをそれぞれのフォルダで所有しています。TerrainRendering00や保存済みの版を、別の版の開発で変更しない構成です。

## 参考資料

- 地形LOD：[Losasso・Hoppe — Geometry Clipmaps](https://hhoppe.com/geomclipmap.pdf)。タイルClipmap方式の出発点となる、入れ子の規則格子による地形LOD
- Octahedralの方向表現：[PBRT 4 — Spherical Geometry](https://www.pbr-book.org/4ed/Geometry_and_Transformations/Spherical_Geometry)。+Zを極としたXYへの展開と復号
- 拡散環境光：[GPU Gems 2 — Real-Time Computation of Dynamic Irradiance Environment Maps](https://developer.nvidia.com/gpugems/gpugems2/part-ii-shading-lighting-and-shadows/chapter-10-real-time-computation-dynamic)。2次SH・9係数による拡散照明の近似と畳み込み
- 大気散乱：[Bruneton — Atmospheric Scattering Functions](https://ebruneton.github.io/precomputed_atmospheric_scattering/atmosphere/functions.glsl.html)。透過率・単一散乱・大気遠近法の基礎式。本実装は単一散乱の直接積分で、同資料の事前計算LUTや多重散乱は実装していません
- PreExposure：[Epic Games — Auto Exposure / Pre-Exposure](https://dev.epicgames.com/documentation/en-us/unreal-engine/auto-exposure-in-unreal-engine#pre-exposure)。HDRカラーをシーンカラーへ保存する前にスケーリングする仕組み。本実装では自動露出ではなく手動のEV100から露出係数を計算します
- トーンマッピング：[Narkowicz — ACES Filmic Tone Mapping Curve](https://knarkowicz.wordpress.com/2016/01/06/aces-filmic-tone-mapping-curve/)。使用しているCC0公開のフィット近似
- sRGB変換：[W3C — CSS Color 4, Color Conversions](https://www.w3.org/TR/css-color-4/#color-conversion-code)。線形RGBからsRGBへ符号化する伝達関数
- Canvasの色空間：[WebGPU — GPUCanvasConfiguration](https://gpuweb.github.io/types/interfaces/GPUCanvasConfiguration.html)。表示色空間とテクスチャ形式の設定
