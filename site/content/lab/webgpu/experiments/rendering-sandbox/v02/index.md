---
title: "RenderingSandbox v02"
date: "2026-10-28"
lastmod: "2026-10-29"
layout: "sandbox"
outputs: ["HTML", "Source"]
description: "4カスケードのシャドウAtlas、GGX・Lambert、Octahedral MapによるSplit-Sum IBLの検証"
---

学習用にAgentCodingで生成したデモです

[版一覧](../) · [前の版：v01](../v01/)

地形を使ってCSMとPBR、天空IBLを確認するレンダリング実験です。v02では2048×2048のAtlasに4カスケードのShadow Mapを描画し、直接光のGGX鏡面反射と、Octahedral Mapを使ったSpecular IBLを追加しています。

<!-- demo -->

## 操作

「実行」で開始します。WASDで前後左右、Q/Eで上下、Shiftで加速、ドラッグ・矢印キーで視点を回転します。ホイールでも前後へ移動できます。

設定パネルは3Dビュー程度の高さで内部スクロールします。上から描画・カメラ・地形・ライト／シャドウ・Sky・デバッグの順です。

- 地形のRoughness・Metallicと固定RGBアルベドで材質を変更できます。RGBは0〜1のリニア反射率です
- 直接光とSpecular IBLは個別にOFFにできます。SkyLight強度はDiffuseとSpecularの両方に掛かります
- カメラの露出はEV100、−10〜15です。値を1増やすと光量は半分になります
- シャドウ距離はCSM全体の最遠距離です。既定は4096 mで、4段の分割位置を自動で求めます
- 「太陽を動かす」で方位角を毎フレーム変更し、天空・SH・GGX Prefilterを同じフレームで更新します。OFFでは静止画を連続描画しません
- 「GGX Octahedral Map」と「GGX Mip」で、Prefiltered Mapの各Mipを表示できます。元のSky Mapと同時にONにすると左右へ並びます
- Sky枠に大気遠近法とSkyLightの設定をまとめています
- デバッグの「メインビュー表示」でメイン深度を全画面表示、「シャドウAtlas（RawDepth）」でシャドウマップを小窓表示できます
- デバッグの「CSMテクセルグリッド」は各段の光源投影上に1・4・16テクセル間隔の格子を表示します。CSM色分けと併用でき、段の切替で世界空間の密度が変わる様子を確認できます。範囲外は暗いグレーです
- CSM色分けは参照するシャドウ段、Height Clipmap色分けは標高段、HeightMapグリッドは16×16標高テクセル単位を示します
- 「カリング・配置を固定」で可視リストと標高窓・シャドウ投影を固定できます。検証中は太陽アニメーションも止まります

## 描画パス

必要な標高更新、天空生成、SH投影、GGX Prefilter、各視点のGPUカリングの後、次の順で描画します。

| パス | 処理 |
| --- | --- |
| ZPrePass | メイン視点の深度を確定 |
| ShadowPass | Atlas内の4領域へカスケードごとのZOnly描画 |
| ForwardShadingPass | GGX＋Lambertの直接光、Diffuse／Specular IBL、大気遠近法、天球をHDR出力 |
| 環境マップのデバッグ表示 | 通常表示時は天空・GGXテクスチャをHDRカラーへ重ねる |
| 最終表示 | 通常時はPostProcessPassでACES FilmicとsRGB符号化を適用。メイン深度表示時は深度テクスチャを直接表示 |
| シャドウAtlasのデバッグ表示 | ONの場合は最終表示へ小窓を重ねる |

ZOnlyはZPrePassとShadowPassで同じ原本を使います。Forwardは深度ReadOnly・Equal比較です。位置計算は`terrain-geometry.wgsl`で共有し、不透明PSにはdiscard・深度出力・Storage書き込みを置きません。

## Cascaded Shadow Maps

### 分割とAtlas

Shadow Mapは2048×2048の`depth32float`を1枚、容量16 MiBです。2×2に分け、それぞれ1024×1024の4カスケードを配置します。clear=0、書込greater、参照greater-equalのReversed Zです。

視点のnear=1 mと指定距離の間を、対数分割75%・一様分割25%で分けます。各分割の受光フラスタムの外接球を求め、光源の正射影の中心をシャドウテクセル単位でスナップします。球の半径はカメラの回転に依存しないため、回転時に投影サイズが伸縮するのを抑えます。

各カスケードの距離範囲の末尾10%は隣のカスケードもサンプリングしてブレンドします。次のカスケードの投影範囲にも、このブレンド領域を含めます。PCFは1・3×3・5×5を選べます。各サンプルのUVを、対象カスケードの領域の端から半テクセル内側までに制限し、Atlasの隣の領域を参照しません。

### シャドウキャスターのカリング

採用したのは、**光源の正射影フラスタムと、受光フラスタムを光源方向へ押し出した凸多面体の両方の条件を使い、GPUでタイルのAABBを判定する方式**です。

メイン視点の可視リストをシャドウへ流用すると、画面外から入る影が消えます。一方、球を囲む光源ボックスだけでは、受光領域へ影を落とせないタイルも残ります。そこで分割ごとの受光フラスタムから、光源側へ押し出しても有効な面とシルエット辺の側面を求め、追加のカリング平面として渡します。光源側へ伸びる体積を使うので、メインビューでは見えないキャスターも残します。

CPUは分割と少数の平面だけを準備します。候補タイルの可視判定・リスト圧縮・Indirect引数の更新はGPUです。MainとCSM0〜3はそれぞれ独立した752 BのScene Uniform、6,400 Bの可視リスト、20 BのIndirect引数を持ちます。同じUniformをdispatch間で上書きしません。

可視タイル数をsubgroup内で集計し、非空subgroupごとに1回だけグローバルAtomicAddで領域を予約します。subgroup非対応時はworkgroupの共有メモリscanで集約します。描画数のCPU読み戻しを待つことはなく、非同期読み戻しはメトリクス表示だけに使います。

これは現在の規模（描画候補は最大1600タイル）とWebGPUの標準的なCompute・Indirect描画を対象に選んだ構成です。2026年の全GPU・全シーンで最速と実測したものではありません。深度分布を用いるSDSM、シャドウの遮蔽カリング、タイルごとの最低・最高標高を用いた境界、カスケード専用LODは未実装です。タイルの高さ範囲には地形全体の最低・最高標高を使うため、地形によっては余分な候補が残ります。

## 直接光のPBR

[入門Test07](../../../introduction/test07/)のモデルに合わせ、GGXのD、非相関Smith GGXのG、Schlick近似のFを個別に評価します。Schlick-GGXへの置換やD・G項の分母の打消しはしていません。

```wgsl
let alpha = roughness * roughness;
let d = distributionGGX(noH, alpha);
let g = smithG1(noL, alpha) * smithG1(noV, alpha);
let f = fresnelSchlick(voH, f0);
let specular = d * g * f / max(4.0 * noL * noV, 0.000001);
let diffuse = (vec3f(1.0) - f) * (1.0 - metallic) * albedo / PBR_PI;
```

F0は非金属の0.04からアルベドへMetallicで補間します。Roughnessは知覚的パラメータで、GGXのalphaへ二乗して渡します。計算の特異点を避けるため下限を0.04とします。直接光にはNoL、光源強度、大気の太陽透過率、CSMの可視率を掛けます。

## SkyLight IBL

### Diffuseは2次SH

背景と同じ地球大気モデルで、256²・`rgba16float`の全方向Octahedral Mapを生成します。+Z極・XY展開で、世界の鉛直はY-upのままです。立体角を補正して2次SHの9係数へ投影し、正規化Lambertの畳み込み係数1・2/3・1/4を適用します。

材質側ではBRDF LUTから鏡面の方向別積分反射率 `E = F0 * A + B` を求め、SHのDiffuseへ `(1 - E) * (1 - Metallic) * Albedo` を掛けます。マクロ法線のSchlick Fresnel(NoV)をDiffuseへ直接使うと、高ラフネスでも斜め視点の拡散光をほぼ消してしまうため、鏡面側と同じGGXの積分値を使います。

### IBLのエネルギー配分と制約

積分した鏡面反射率を使ってDiffuseへの配分を決める考え方には実用例があります。[three.jsのIBL実装](https://github.com/mrdoob/three.js/blob/dev/src/renderers/shaders/ShaderChunk/lights_physical_pars_fragment.glsl.js)では、単一散乱と多重散乱の鏡面反射率をDiffuse側から差し引きます。本版の `1 - E` は、単一散乱のみを扱う簡略形です。唯一の標準式や、three.jsと同一の材質モデルという意味ではありません。

これはSplit-Sumに合わせたエネルギー配分の近似で、厳密な層状材質モデルではありません。多重散乱による鏡面のエネルギー補償も加えていないため、特に粗い金属では単一散乱GGXに由来する暗化が残ります。この点は[Filamentの鏡面反射のエネルギー損失と補償](https://google.github.io/filament/main/filament.html#materialsystem/improvingthebrdfs/energylossinspecularreflectance)でも扱われています。直接光のBRDFは、このIBL側の配分変更では変えていません。

実GPUでは、一様な白色天空を想定した非金属について、3段階のRoughnessと3段階のNoVでDiffuseとSpecularの配分の和を確認しています。Roughness=1・NoV=0.005でもDiffuseが保持されます。ただし、この検証は任意の照明分布に対する物理的正確さを証明するものではありません。非一様な天空では、SHによるDiffuseと反射方向を中心とするPrefilter環境の近似誤差も含まれます。

### GGX PrefilterとBRDF LUT

SpecularはSplit-Sum近似です。環境側はN=V=Rを仮定してGGXで重要度サンプリングし、NoLで加重・正規化した天空をラフネスごとのMipへ格納します。通常の縮小Mipをぼかす処理ではなく、各Mipを元の天空から64サンプルで直接生成します。

BRDF側はNoVとRoughnessの128² LUTです。初期化時に256サンプルで積分し、Schlick FをF0に掛かる成分Aと加算成分Bへ分けます。Gは直接光と同じ非相関Smithです。LUTは天空に依存せず、再生成しません。

```wgsl
let reflected = reflect(-v, n);
let environment = sampleOctRoughness(specularMap, brdfSampler, reflected, roughness);
let dfg = textureSampleLevel(brdfMap, brdfSampler, vec2f(noV, roughness), 0.0).rg;
let specularIBL = environment * (f0 * dfg.x + dfg.y);
```

### Octahedralのボーダーとハードウェア補間

Prefiltered Mapは物理サイズ256²・128²・64²・32²・16²の5段です。各辺に16・8・4・2・1テクセルの折り返しボーダーを生成します。有効解像度は224²・112²・56²・28²・14²です。全Mipで、各辺のボーダー幅をテクスチャ幅の1/16に揃えます。

```wgsl
let uv = octahedralUV(direction) * 0.875 + 0.0625;
return textureSampleLevel(map, filterSampler, uv, roughness * 4.0).rgb;
```

この共通UVと`mipmapFilter: linear`により、シェーディング時は**1回のテクスチャサンプリングでハードウェアのトリリニア補間**を利用できます。ボーダーのない通常のOctahedral UVをclampしたり、単純なmirror-repeatを使ったりする方式ではありません。八面体の面同士の接続に従って隣接領域を折り返し、各Mipのボーダーへ事前に書き込みます。

ボーダーを確保するため小さいMipで打ち切り、Roughness 0・0.25・0.5・0.75・1を割り当てています。5段の間はハードウェアが補間します。これは1×1までの通常Mip chainと同一ではありません。Prefilter前の天空テクスチャはボーダーなしなので、Prefilter生成時だけ手動の境界対応バイリニアを使います。

「GGX Octahedral Map」でボーダーを含むMip全体を表示できます。「GGX Mip」で0〜4を切り替えます。元のSky Mapと同じ露出・トーンマッピングを通すため、入力と加工結果を比較できます。

### 動的更新

太陽方向または観測高度が変わったフレームでは、天空→SH→GGX全Mipを更新してからForwardで参照します。更新を複数フレームへ分散せず、そのフレームで生成したPrefilter結果を使います。「太陽を動かす」でこの更新を連続確認できます。水平移動・回転・露出・材質だけの変更では環境マップとSH係数を再計算しません。

GPUの処理待ちのフレームが溜まることを避けるため、処理中のフレームは最大1つに制限しています。CPUを同期的に待機させず、GPUの完了通知を受けて次の描画を予約します。64サンプルのPrefilterは高コントラストの小光源には不足する場合があり、今回は太陽円盤のない大気天空が対象です。

## HDRレンダリング

直接光・IBL・大気は線形HDRで合成し、Forwardと天球のPS最終段でカメラのPreExposureを掛けて`rgba16float`へ出力します。環境Map・SH・BRDF LUT自体には露出やトーンマッピングを掛けません。

## 大気遠近法フォグ

大気遠近法は視点から地形までの透過率と散乱光を合成します。天球はピクセルレイで大気を直接評価します。地球の単一散乱モデルで、Height Fog・多重散乱・体積影は未実装です。

## トーンマッピング

ポストプロセスはACES Filmicのフィット近似とsRGB符号化のみです。露出を再適用しません。自動露出やHDRディスプレイ向けの出力変換は未実装です。

## 深度と描画リソースの表示

メインビューはnear=1 m・far=無限遠の透視投影で、NDCのZは0〜1です。視点空間での前方距離を `d` とすると、保存する深度は `1 / d` になります。nearで1、遠方ほど0へ近づきます。DepthBufferは `depth32float`、クリア値は0、ZPrePassの比較はgreaterです。ForwardはZPrePassの深度をEqualで参照し、深度を書き換えません。

CSMもReversed Zですが、光源の投影は有限範囲の正射影です。光源に近い側が1、遠い側が0となり、透視投影の `1 / d` とは異なって深度は線形に変化します。クリア値は0、書き込み時はgreater、比較サンプリングはgreater-equalです。メインビューとCSMは、いずれも本版の初期実装からReversed Zを使用しています。

デバッグの「メインビュー表示」で「RawDepth」または「LinearDepth」を選ぶと、画面全体をDepthBufferのグレースケール表示へ切り替えます。環境マップのような小窓表示にはせず、今後のメインビューの描画リソースも、この表示切替へ追加する方針です。「シャドウAtlas（RawDepth）」は2048×2048のテクスチャ全体を小窓に表示し、4カスケードをまとめて確認できます。環境マップと同時に表示すると横に並びます。

RawDepthはDepthBufferの値を0〜1のまま表示します。0は黒、1は白です。メインビューでは100 mで0.01、1 kmで0.001となるため、大部分が黒に近く見えるのが正常です。CSMは正射影のRawDepthをそのまま表示し、距離への変換は行いません。

LinearDepthでは `LinearDepth = near / RawDepth` で視点空間の前方距離を復元し、`clamp(LinearDepth / 正規化距離, 0, 1)` を表示します。カメラからの直線距離ではありません。正規化距離は初期値1,000 m、10〜16,000 mで調整できます。近くは黒、指定距離以上は白です。未描画の空（RawDepth=0）は無限遠として白く表示します。

RawDepth・LinearDepthとも、露出・トーンマッピング・sRGB符号化を適用せず、可視化の値をそのまま画面出力値に使います。

## 主なGPUリソース

| リソース | 形式・容量 |
| --- | --- |
| Height Clipmap | 1024²×7段、FP16、14 MiB（16 km設定） |
| タイル共有IB | uint16、描画＋ワイヤー約96.5 KiB、VBなし |
| Main＋CSM4視点 | 各752 B Uniform＋6,400 B可視リスト＋20 B Indirect |
| Lighting／Camera | 464 B／16 B Uniform |
| Shadow Atlas | 2048² depth32float、16 MiB |
| メイン深度／HDRカラー | 960×540、約1.98 MiB／3.96 MiB |
| 天空Octahedral | 256² rgba16float、512 KiB |
| GGX Octahedral | 256²〜16²・5 Mip、rgba16float、682 KiB |
| BRDF LUT | 128² rgba16float、128 KiB |
| SH投影の中間バッファ／SH係数 | 144 KiB／144 B |

## 検証と制約

CPUテストは分割の被覆と、受光領域から光源方向へ離れたキャスターが追加平面で誤除外されないことを確認します。深度表示のGPUテストでは既知の深度0・0.25・0.5・1を入力し、全画面表示の値と上下方向、小窓の範囲を確認します。描画のGPUテストはZPrePass/Forwardの被覆、Atlasでの影、HDR、IBLの定数保存・更新、ボーダー値の一致、端をまたぐトリリニア参照を検証します。

シーン内の反射物をキャプチャするIBL、局所AO・GI、シャドウ専用LOD、遮蔽カリングは未実装です。CSMの最遠距離より先は影なしです。この版の画質・処理負荷を確認するための設定であり、GPUタイムスタンプによる機種別の最適化比較は行っていません。

v00・v01の実行資源は変更せず、それぞれの版のフォルダで完結しています。

## 参考資料

- [Microsoft — Cascaded Shadow Maps](https://learn.microsoft.com/en-us/windows/win32/dxtecharts/cascaded-shadow-maps)：分割、安定化、Atlas、PCF境界処理の基礎
- [AMD GPUOpen — Optimizing Terrain Shadows](https://gpuopen.com/learn/optimizing-terrain-shadows/)：地形シャドウの不要描画削減を検討する際の参考。本版に同資料の地形遮蔽方式を実装したという意味ではありません
- [Filament — Image Based Lights](https://google.github.io/filament/Filament.html#lighting/imagebasedlights)：Prefilter環境とBRDF積分の分離。材質モデルや全補償項をFilamentと一致させた実装ではありません
- [PBRT 4 — Spherical Geometry](https://www.pbr-book.org/4ed/Geometry_and_Transformations/Spherical_Geometry)：Octahedralの方向表現
- [Bruneton — Atmospheric Scattering Functions](https://ebruneton.github.io/precomputed_atmospheric_scattering/atmosphere/functions.glsl.html)：大気の透過率と単一散乱の基礎式
- [Narkowicz — ACES Filmic Tone Mapping Curve](https://knarkowicz.wordpress.com/2016/01/06/aces-filmic-tone-mapping-curve/)：表示に使うフィット近似
