---
title: "Test07-Directional LightとLambert・GGX"
layout: "experiment"
outputs: ["HTML", "Source"]
description: "球メッシュを平行光源で照らし、Lambert拡散反射とGGX鏡面反射を確認するWebGPU実験"
---

学習用にAgentCodingで生成したデモです

球メッシュを1つのDirectional Lightで照らします。正規化Lambertの拡散反射とGGXの鏡面反射を組み合わせ、アルベド、Roughness、Metallic、ライト方向を操作できます。球とカメラは固定で、UI変更時だけ再描画します。

アルベドは初期化時にComputeで帯模様を生成します。[Test06](../test06/)と同様に画像ファイルは使いません。法線マップ、環境光、IBL、影は付けていません。

## 操作

「実行」でGPU初期化と描画を行います。その後は各UIの変更で更新し、「再描画」で同じ設定を描き直せます。

- **アルベドテクスチャ**：OFFでは模様の基準色を使います。ON/OFFで画像は再生成しません。
- **Roughness**：0.05〜1、初期値0.35。小さいほどハイライトが狭く鋭くなります。
- **Metallic**：0〜1、初期値0。1では拡散成分がなくなり、アルベド色を鏡面反射の基準色に使います。
- **ライト方位角・仰角**：球から光源を見る方向を指定します。Y-up、方位角0°が+Z、+90°が+X。仰角0°は水平、+90°は真上です。光線が進む向きはこの逆です。
- **表示**：合成／拡散のみ／鏡面のみを切り替えます。どの表示にも同じライト強度と表示変換を適用します。

「初期値に戻す」で材質・ライト方向・表示を戻します。直接光のみなので、光の当たらない側や、光源を背面へ回した場合は暗くなります。

<!-- demo -->

## コードの解説

初期化・Reversed Zは[Test05](../test05/)、Compute生成とTextureのバインドは[Test06](../test06/)を参照してください。今回は法線、ライト方向、材質の受け渡しとライティングの実装を抜粋します。各Testのコードは独立しており、他のTestから実行コードを読み込みません。

### 球メッシュと法線

```typescript
vertices.push(nx, ny, nz, nx, ny, nz, u, v);
```

単位球の位置と法線は同じXYZです。位置3個・法線3個・UV2個のfloatを並べ、strideは32バイトです。経度128・緯度64に分割し、極の面積0の三角形は作りません。UVの継ぎ目は頂点を分けています。

```wgsl
output.worldPosition = position;
output.normal = normal;
let n = normalize(input.normal);
```

VSとFSの別々の箇所の抜粋です。モデル変換が恒等行列なので、頂点位置と法線をそのままワールド空間へ渡せます。ラスタライズで補間された法線はFSで正規化し直します。一般の非一様スケールを加える場合は、法線の逆転置変換も必要です。

### ライト方向

```typescript
const light: Vec3 = [Math.cos(elevation) * Math.sin(azimuth), Math.sin(elevation), Math.cos(elevation) * Math.cos(azimuth)];
```

角度をラジアンへ変換した後の処理です。生成するベクトルは表面から光源へ向くLです。Directional Lightなので、全画素で共通の方向と強度を使い、距離減衰は付けません。

### UIの値をuniformへ送る

```typescript
data.set([...light, 0], 20);
data.set([Number(roughnessControl.value), Number(metallicControl.value), albedoControl.checked ? 1 : 0, Number(viewControl.value)], 24);
```

Float32Array内のオフセットはバイトではなくfloatの個数です。行列64バイトの後に、カメラ、ライト方向、材質、基準色とライト強度を各vec4で並べ、合計128バイトにしています。TSからqueue.writeBufferで送り、group 0のuniformをVS・FSの両方から参照します。

```typescript
control.addEventListener('input', () => { updateOutputs(); if (demo) void render(); });
```

スライダーはinputイベントで数値表示と描画を更新します。requestAnimationFrameの連続ループは使いません。生成Computeもrenderには含めず、GPU初期化時だけ実行します。

### BRDFと入射光を分ける

```wgsl
let d = distributionGGX(noH, alpha);
let g = smithG1(noL, alpha) * smithG1(noV, alpha);
let f = fresnelSchlick(voH, f0);
```

GGXのD、非相関SmithのG、Schlick近似のFを個別に評価します。roughnessは知覚的なパラメーターで、alpha = roughness²です。Gは平方根を含む式を使い、Schlick-GGX近似や粗さの再マッピングは入れません。

```wgsl
let specular = (d * g * f) / max(4.0 * noL * noV, 1e-8);
let diffuse = (vec3f(1.0) - f) * (1.0 - metallic) * baseColor / PI;
radiance = brdf * parameters.baseColorAndLight.w * noL;
```

離れた箇所の抜粋です。D・Gと分母の因子を相殺せず、Cook–Torranceの形で書きます。Lambertの1/πと、入射光へ掛けるN·Lは別です。表示で選んだBRDFに白色ライトの強度4とN·Lを掛けます。分母の下限、N·L・N·Vが非正の場合の除外、半角ベクトルが定義できない場合の除外は数値対策です。

### 線形空間とTonemapping

```wgsl
let mapped = radiance / (vec3f(1.0) + radiance);
return vec4f(linearToSRGB(mapped), 1.0);
```

ライティングは線形値で計算し、露出1、チャンネルごとのReinhard Tonemapping（トーンマッピング）、明示的なsRGB変換を経て通常のunorm Canvasへ出力します。アルベドもComputeが線形反射率として生成し、rgba8unormから自動sRGBデコードせず読みます。外部のsRGB画像をそのまま同じ扱いで入力する構成ではありません。

## 採用モデル

- 拡散：正規化Lambert。合成時は(1−F)と(1−Metallic)を掛けます。
- 鏡面：GGXのD、非相関Smith GGXのG、Schlick近似のF。非金属のF0は0.04で、Metallicに応じてアルベド色へ補間します。
- 単一散乱の直接光のみです。完全なエネルギー補償、多重散乱、IBLは扱いません。

Roughness 0は完全鏡面の特異なケースになるため、UI下限を0.05にしています。近似モデルの比較や各式の導出は別の実験へ回します。

## 期待される結果

球の明暗境界がライト方向に追従し、視線方向との関係でハイライトが移動します。Roughnessを下げるとハイライトが鋭くなり、Metallicを上げると拡散が減って鏡面反射へ色が付きます。Metallic 1で「拡散のみ」を選ぶと球は黒くなります。

帯模様はアルベドだけを変え、凹凸やRoughnessは変えません。OFFで均一な基準色に戻すと、法線と光による変化を観察しやすくなります。

## 制約

WebGPU対応環境とHTTPSまたはlocalhostが必要です。Canvasは960×540固定で、深度はReversed Zです。球はメッシュなので輪郭は分割数に依存します。アルベドは256×256、Mipなしの線形フィルタです。カメラ操作、法線マップ、環境光、影、モデル比較、リサイズは扱いません。

参考：[Microfacet Models for Refraction](https://www.cs.cornell.edu/~srm/publications/EGSR07-btdf.pdf)、[Real Shading in Unreal Engine 4](https://cdn2.unrealengine.com/Resources/files/2013SiggraphPresentationsNotes-26915738.pdf)
