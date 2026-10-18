---
title: "Test08-Shadow Map"
layout: "experiment"
outputs: ["HTML", "Source"]
start_label: "開始"
description: "床と動くCubeのShadow MapでPCF、深度バイアス、法線バイアスを確認するWebGPU実験"
---

学習用にAgentCodingで生成したデモです

床の上で回転・上下移動するCubeに、Directional Lightの影を付けます。ライト視点の深度を単一のShadow Mapへ描き、カメラ視点の描画で比較します。ライティングは[Test07](../test07/)と同じLambertとGGXで、カメラ・Shadow MapともReversed Zを使います。

## 操作

「開始」で連続描画、「停止」でCubeを静止、「再開」で続きから動かします。停止中でも全UIを変更できます。別タブへ移ると停止します。

- **影を表示**：同じ姿勢で影の有無を比較します。
- **PCF**：なし（Nearestの1点比較）／3×3（9点）／5×5（25点）を選びます。
- **深度バイアス（Depth Bias）**：シャドウ比較時の参照深度を補正します。単位は正規化深度です。
- **法線バイアス（Normal Bias）**：影を参照する位置をワールド法線方向へ移動します。単位はワールド単位です。
- **ライト方位角・仰角**：表面から光源へ向く方向です。Y-up、方位角0°が+Z、+90°が+X、仰角0°が水平、+90°が真上です。
- **表示**：シーン／Shadow Mapの生の深度表示を選びます。深度は近いほど白く、クリア値0は黒です。

Canvas上の左ドラッグ／1本指ドラッグで注視点を中心に回転し、ホイール／2本指のピンチでズームします。慣性・平行移動は付けていません。上下角は±85°、注視点までの距離は3〜16に制限します。Cubeの停止中も操作できます。Shadow Map表示中はカメラ操作を無効にし、通常のページスクロールへ戻します。

「カメラを戻す」は初期位置と注視点へ戻します。カメラの変更はライト視点の行列へ影響しません。

「初期値に戻す」はPCF、バイアス、ライト、表示を戻し、Cubeの時刻と停止状態は保ちます。光源が床の下へ回ると、床の上面は直接光が当たらず暗くなります。

<!-- demo -->

## コードの解説

反射モデルとTonemappingは[Test07](../test07/)と同じ構成です。ここではShadow Mapの生成と参照だけを抜粋します。各Testは独立した実装です。DirectX 12との比較は役割の近似です。

### Orbitカメラ

```typescript
const camera = cameraPosition();
const viewProjection = multiply(reversedPerspective(canvas.width / canvas.height), lookAt(camera, cameraTarget, [0, 1, 0]));
```

注視点(0, 0.7, 0)を中心に、方位・上下角・距離から視点を求めます。カメラ行列とPBRの視線計算に渡す位置を同時に更新します。

```typescript
canvas.setPointerCapture(event.pointerId);
```

Pointer Eventsでマウスとタッチを扱います。ドラッグ中にCanvas外へ出ても入力を受け取り、終了・キャンセル時に解放します。1本指は回転、2本指は指間距離の比でズームし、指を離すと停止します。カメラ操作は停止中のシーンも再描画します。

### ライト視点の深度

```typescript
shadowMap = device.createTexture({ size: [shadowSize, shadowSize], format: 'depth32float',
  usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING });
```

1024×1024の深度テクスチャを描画先と読み取り元の両方に使います。ライトは原点付近のシーンを正射影し、幅・高さ10、Near 1、Far 20の範囲を描きます。ライト方向に応じてView行列を更新しますが、自動的な範囲フィッティングやカスケードは行いません。

```wgsl
return frame.lightViewProjection * object.model * vec4f(position, 1.0);
```

shadow.wgslのVSです。床とCubeをライト視点で描き、Fragment Shaderやカラーアタッチメントは使いません。正射影でもNDC Zは0〜1で、Nearが1、Farが0です。

```typescript
const shadowPass = encoder.beginRenderPass({ colorAttachments: [], depthStencilAttachment: {
  view: shadowView, depthClearValue: 0, depthLoadOp: 'clear', depthStoreOp: 'store',
} });
```

深度だけのRender Passです。PSOの比較はgreater、クリアは0です。storeで結果を保持してパスを終了し、次のカメラ描画で読みます。ライト視点にも床とCubeの両方を描くので、それぞれがCaster・Receiverとして機能します。

### TS側のバインド

```typescript
{ binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'depth' } },
{ binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'comparison' } },
```

shadowLayoutのentriesです。通常の色テクスチャと異なり、depthとcomparisonを指定します。group 0はフレーム共通データ、group 1は各オブジェクト、group 2がShadow Mapと比較Samplerです。

```typescript
const sampler = device.createSampler({ compare: 'greater-equal', minFilter: 'nearest', magFilter: 'nearest' });
```

Reversed Z用の比較Samplerです。参照深度が保存済み深度以上なら、その参照点まで光が届くと判断します。Nearestなので1回の比較は1テクセル分です。PCFはシェーダー側で複数回読みます。

```typescript
{ binding: 0, resource: shadowView }, { binding: 1, resource: sampler },
pass.setBindGroup(2, shadowGroup);
```

Bind Groupのentriesと、カメラ描画での設定を抜粋しています。Shadow Mapへ書くパスではgroup 2をバインドせず、uniformだけを渡します。同じ深度リソースを1つのパスで書き込み先と読み取り元にしないためです。

### ライト空間の座標とバイアス

```wgsl
let offsetPosition = position + normal * frame.shadow.z;
let clip = frame.lightViewProjection * vec4f(offsetPosition, 1.0);
```

法線バイアスを適用した位置から、影を参照する座標を求めます。実際のメッシュや画面上の描画位置は動かしません。モデル行列は回転・平行移動のみなので、法線も回転部分でワールド空間へ変換しています。

```wgsl
let uv = vec2f(ndc.x * 0.5 + 0.5, 0.5 - ndc.y * 0.5);
let reference = ndc.z + frame.shadow.y;
```

NDCのXYをUVへ変換し、Yだけ上下を合わせます。Zは既に0〜1なので、0.5倍して加算する変換は不要です。深度バイアスはReversed Zの参照深度へ正値を加算し、光源に近い側へ比較を緩めます。ラスタライズ時のdepthBiasやdepthBiasSlopeScaleは使っていません。

### PCF

```wgsl
let sampleUV = uv + vec2f(f32(x), f32(y)) / frame.shadow.w;
visibility += textureSampleCompareLevel(shadowMap, shadowSampler, sampleUV, reference);
```

PCFループ内の抜粋です。1テクセルずつずらした座標で深度比較を行います。textureSampleCompareLevelは暗黙微分に頼らずレベル0を比較するため、条件分岐内でも使えます。HLSLのSampleCmpLevelZeroに近い役割です。

```wgsl
return visibility / count;
```

比較結果の平均を光の可視率にします。深度値そのものを平均してから比較する処理ではありません。Shadow Mapの範囲外は照らされているものとして扱い、PCFの周辺サンプルも同様に処理します。

```wgsl
radiance = (diffuse + specular) * frame.light.w * noL * visibility;
```

可視率を直接光の拡散・鏡面の両方へ掛けます。反射モデルはGGXのD、非相関SmithのG、Schlick Fを分けたままで、分母との因子相殺は行いません。材質は非金属固定で、床のRoughnessは0.7、Cubeは0.35です。

## アーティファクトの確認

停止してPCFをなしにし、両方のバイアスを0へ下げると、面上の自己遮蔽による縞や点状のShadow Acneを観察できます。出方はライト角度・画素・端末の演算精度で変わります。

深度バイアスや法線バイアスを増やすと自己遮蔽を抑えられますが、上げすぎると影が小さくなったり、Casterから離れるPeter Panningが生じます。法線バイアスは参照位置を動かすため、深度だけでなくUVも変化します。

PCFは影の輪郭のジャギーを和らげますが、自己遮蔽の原因を解消するものではありません。また、固定幅のフィルタなので、光源サイズや物体間距離に応じた物理的な半影ではありません。

## 期待される結果

Cubeの移動・回転に追従して床の影が動きます。ライトを回すと影の方向と長さが変わり、真上ではCubeの下へ落ちます。PCFの範囲を広げると影の境界が柔らかくなります。

Shadow Map表示では、床とCubeをライトから見た深度が分かります。バイアスは比較時だけの補正なので、この保存深度の表示は変わりません。

## 制約

WebGPU対応環境とHTTPSまたはlocalhostが必要です。Canvasは960×540、Shadow Mapは1024×1024固定です。ライトが真上・真下でもView行列が破綻しないよう、極付近では補助のup軸を切り替えます。

直接光だけで、影の中は黒くなります。環境光、IBL、カスケード、接地影、テクスチャ素材、物理的なソフトシャドウ、リサイズは扱いません。床とCubeのアルベドはuniformの定数色です。表示はReinhard TonemappingとsRGB変換を使います。

参考：[WebGPU Shadow Mappingサンプル](https://webgpu.github.io/webgpu-samples/?sample=shadowMapping)
