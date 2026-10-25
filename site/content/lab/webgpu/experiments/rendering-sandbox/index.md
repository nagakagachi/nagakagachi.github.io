---
title: "RenderingSandbox"
date: "2026-10-26"
lastmod: "2026-10-26"
layout: "experiment"
outputs: ["HTML", "Source"]
description: "地形や配置物を使ったレンダリング技法の実験環境"
---

学習用にAgentCodingで生成したデモです

TerrainRendering00をベースにしたレンダリング実験環境です。現在はプロシージャル地形に、ZPrePass・ShadowPass・ForwardShadingPassを適用し、ピクセルレイの天球と1次SHのDiffuse SkyLightを加えています。今後、配置物や新しいシャドウ技法、GIを追加していく実験環境の初版です。

- 「実行」で開始。ビューをクリックし、WASDで前後左右、Q/Eで上下、Shiftで加速、ドラッグ・矢印キーで回転します
- ライトは方位角と仰角で変更できます。方位角0°は+Z、90°は+X、仰角は水平からの角度です
- シャドウON/OFFで影を比較できます。「シャドウ可視率表示」は白が受光、黒が遮蔽です。法線表示はこれより優先します
- Shadow Mapは2048²の1枚です。投影半幅の初期値は2kmで、光源平面の4km四方をカバーします。範囲外は影なしで表示します
- 深度バイアス・法線バイアス・PCFを調整できます。PCFの各tapにもハードウェアの線形比較フィルタが掛かります
- SkyLight Diffuseの強度で、天球から投影したSH拡散光を調整できます。法線方向によって値が変わり、影内だけでなく全体へ適用します。背景の空の明るさとは独立した調整です
- タイル色分け・ワイヤーフレーム・セルスナップ・密度・カバー半径はTerrainRendering00と同じです
- フリーズはMain/Shadowの両可視リスト、地形配置、標高キャッシュ、光源投影を固定します。カメラだけを動かして、カリング結果を観察できます

操作はWebGPU対応ブラウザとキーボード・マウスを使うPC向けです。衝突判定はありません。静止中は連続描画せず、カメラやライト操作時に再描画します。

<!-- demo -->

## Passの構成

空の変更時にOctahedral生成・SH投影 → 標高の差分生成 → Main/Shadowの独立カリング → ZPrePass → ShadowPass → ForwardShadingPassの順に発行します。

```ts
object.drawDepth(prepass, 'main');
object.drawDepth(shadow, 'shadow');
object.drawForward(forward);
background?.draw(forward);
```

ZPrePassでメイン深度を先に確定し、将来のSSAOなどがこの深度を参照できる順序にしています。現時点ではSSAOや非同期Computeを追加していません。

Passの発行は`render-passes.ts`、地形の描画・資源の管理は`main.ts`が担当します。今後の不透明モデルも`OpaqueRenderable`へ登録し、位置専用のZOnlyバリエーションとForwardバリエーションを用意する枠組みです。モデル読み込みはまだ実装していません。背景の天球は不透明物とは別の描画契約で登録します。

## 共通の位置計算とZOnly

```wgsl
return terrainVertex(id, instance).clip;
```

`terrain-geometry.wgsl`の位置・標高・LOD接続計算を、ZOnlyとForwardへ同じソースとして組み込みます。`terrain-zonly.wgsl`は位置だけを返し、法線取得やPSはありません。メインとシャドウは同じZOnly Pipelineを使い、group(0)の視点と可視リストだけを変更します。

```ts
depthStencil: { format: 'depth32float', depthWriteEnabled: false, depthCompare: 'equal' }
```

ZPrePassが深度を書き、ForwardはReadOnlyの深度AttachmentへEqual比較で描画します。両方の位置出力に`invariant`を指定し、同じ頂点位置計算を使います。不透明PSでdiscard/clip、深度出力、Storage書込を行いません。将来、頂点変形を追加するときもZOnlyとForwardで同じ位置を出す必要があります。

## シャドウ用のカリング

メイン用とシャドウ用で480バイトのScene Uniform、6,400バイトの可視タイルリスト、20バイトのIndirect引数を別々に保持します。ライトの正射影行列から6平面を取り、地形の保守的AABBで判定します。メインで見えない地形も、光源側の範囲に入ればキャスターとして描画します。

候補タイル・LOD・標高キャッシュは共通です。シャドウのために別のLOD地形を生成しないので、受け手とキャスターの形状が一致します。subgroup集約、未対応時のworkgroup scanも維持しています。表示用の可視数だけを非同期で読み、描画にCPU読戻しは使いません。

## Directional Lightと影の参照

```wgsl
let direct = lighting.light.w * max(dot(n, lighting.light.xyz), 0.0) * visibility / 3.14159265;
```

今回のライティングは正規化Lambertの直射光と、仮のSkyLight Diffuseです。直射光だけにShadow Mapの可視率を掛けます。地形の標高に応じた無彩色アルベドに適用し、最後に近似ガンマ変換します。

## ピクセルレイの天球と1次SH

```wgsl
let ray = normalize(view.forward.xyz + input.ndc.x * view.right.xyz + input.ndc.y * view.up.xyz);
let linear = skyRadiance(ray);
```

背景はカメラからのピクセルレイを求め、`sky-common.wgsl`の`skyRadiance`を直接評価します。画面表示では環境マップを参照しません。初期版は明るい地平線・青い天頂・暗い下半球と、太陽周辺の広い光を持つ晴天風の近似です。大気密度に沿った積分や多重散乱はまだ行いません。将来の大気散乱計算はこの方向→線形放射輝度の関数へ追加する構成です。鋭い太陽円盤は含めず、直射光はDirectional Lightが担当します。

背景はForwardShadingPass内で、不透明物の後・ワイヤーフレームの前に描きます。全画面三角形をReversed Zの最遠方（Z=0）へ置き、ReadOnly深度とgreater-equal比較を使います。地形がある画素には空を描かず、PSでのdiscardや深度出力も使いません。

```wgsl
textureStore(skyMap, vec2i(id.xy), vec4f(skyRadiance(direction), 1.0));
```

SkyLight用には同じ天球関数を256×256のOctahedral Mapへ描画します。形式は線形のrgba16floatで512 KiB、キューブマップは使いません。ワールド空間のYを上方向とし、下半球も含む全方向を1枚へ折り畳みます。

```wgsl
let kernel = select(0.6666666667, 1.0, c == 0u);
result.coefficients[c] = vec4f(sums[c * 64u].rgb * normalization * kernel, 0.0);
```

**1次SHはl=0,1の2バンド・4係数**です。基底の順序は[定数, X, Y, Z]で統一します。投影では各テクセルにOctahedral復号のJacobian `1/|v|³`を掛け、総立体角を4πへ正規化します。UV上の全テクセルを同じ面積として加算する方式にはしません。

Lambertのclamped cosine畳み込み（0次π、1次2π/3）とBRDFの1/πを係数へ含めるため、保存時の帯域係数は0次1・1次2/3です。64スレッドのworkgroupで局所和を作り、次の1workgroupで4係数へ集約します。グローバルAtomicや係数のCPU読戻しは使いません。

```wgsl
let skyDiffuse = albedo * evaluateSkySH(skySH, n) * lighting.skyDiffuse.w;
let linear = albedo * direct + skyDiffuse;
```

ForwardのPSではワールド法線で4係数を評価します。上向き・斜面・下向きで天球から受ける量が変わり、Directional Lightの影内でも法線による凹凸が分かります。低次SHの打切りで負になる値は0へ抑えます。強度の初期値は1、0にすると直射光のみです。

空のOctahedral MapとSHは初回とライト方向変更時だけ更新します。カメラ回転・移動やSkyLight強度の変更では再投影せず、背景のピクセルレイは新しい視線で描き直します。AO、地形による空の遮蔽、局所GIは未実装です。1次SHは低周波の近似なので、鋭い方向性や細かい遮蔽は表現しません。

## Shadow Map

Shadow MapもNDC Z=0〜1のReversed Zで、clear=0、書込比較はgreater、参照比較はgreater-equalです。比較時の深度バイアスは受け手の参照Zへ加算し、法線バイアスは参照用のワールド座標を法線方向へ移動します。ZPrePassの頂点位置は変更しません。

光源平面の中心をシャドウテクセルへスナップします。深度範囲には現在の候補地形全体を保守的に含め、投影XY範囲は独立して調整します。カスケード、接触影、遮蔽カリング、シャドウ専用LODは未実装です。現在の地形配置範囲外にある山は影を落としません。大きい投影範囲・低い仰角・粗い地形LODでは影の解像度やバイアスの限界があります。

## 地形と資源

地形は[TerrainRendering00](../terrain-rendering00/)と同じFP16 Height Clipmap方式で、1024²×7段の初期設定で14 MiBです。64×64セルのタイル共有IBを使い、VBは持ちません。Shadow Mapはdepth32floatの2048²で16 MiB、メイン深度は960×540で約1.98 MiBです。タイル描画用・ワイヤーフレーム用IBも共有します。天球はOctahedral Map 512 KiB、SH局所和64 KiB、SH係数64バイト、生成条件とピクセルレイ基底のUniform計64バイトです。

この実験のソースは同じフォルダ内で独立して管理します。TerrainRendering00のコードや挙動は変更しません。

## メトリクス

「実行状況」にはMain/Shadowの可視タイル数、標高の差分更新量、天球・SHの更新状態、配置・カリングの更新状態を表示します。「構成情報」は折りたたみ式で、適用中の地形条件、LOD、標高キャッシュ、Shadow Map、SkyLight、GPUリソースなどを確認できます。構成情報は値が変わったときだけ表示を書き換えます。
