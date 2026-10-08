---
title: "Test04"
layout: "experiment"
outputs: ["HTML", "Source"]
start_label: "開始"
description: "Compute Shaderで残像をぼかし、減衰させながら動く光点を重ねるWebGPUの実験"
---

学習用にAgentCodingで生成したデモです

動く3つの光点を描画し、前フレームの残像にブラーと減衰を適用して重ねます。[Test03](../test03/)の後処理をCompute Shaderへ移し、フレームをまたいで結果を残す実験です。描画・Compute・表示の3パスを毎フレーム実行します。

## 操作

「開始」で連続描画、「停止」で静止、「再開」で続きから描画します。速度は光点の移動速度で、0倍でも残像の更新は続きます。半減時間を長くすると軌跡が長く残ります。「履歴クリア」は残像だけを消し、その時点の光点を描き直します。停止中も使えます。

別のタブへ移ると描画を停止します。戻ったら「再開」で続けてください。

<!-- demo -->

## コードの解説

初期化・uniform・フルスクリーン三角形は先行Testの説明を参照してください。ここではComputeと履歴更新を抜粋します。DirectX 12との比較は役割の近似です。コードは他のTestへ依存しない独立した実装です。

### UIと描画ループ

```html
<button id="gpu-clear" type="button" disabled>履歴クリア</button>
<input id="gpu-speed" type="range" min="0" max="3" step="0.1" value="1" disabled>
```

controls.txtの抜粋です。共通experiment.htmlがこれを挿入し、main.jsがidで取得してイベントを登録します。Canvasは共通テンプレートのgpu-canvasを使います。

```javascript
frame = requestAnimationFrame(tick);
```

ブラウザに次の画面更新に合わせてtickを呼ぶよう予約します。ループ内で次の呼び出しを予約するため、C++のwhileループでブラウザのUIスレッドを占有しません。返り値は予約を取り消すためのIDです。停止時はcancelAnimationFrame(frame)で取り消します。

```javascript
time += delta * Number(speed.value);
```

速度はシーンの時間だけに掛けます。残像の減衰には実際のフレーム間隔deltaを使うので、速度0でも残像は消えていきます。長い中断の直後に跳ばないようdeltaは最大1/30秒に制限します。

### 履歴テクスチャ

```javascript
usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
```

履歴2枚は同じ設定です。読み取り用テクスチャ、Computeの書き込み先、初期化・クリア用の描画先という3つの用途を許可します。STORAGE_BINDINGが今回の追加点で、D3D12のUAVに近い用途です。

```wgsl
@group(0) @binding(1) var previousTexture: texture_2d<f32>;
@group(0) @binding(2) var nextTexture: texture_storage_2d<rgba8unorm, write>;
```

前フレームはSRVに近い読み取り、次フレームはRWTexture2Dの書き込み用途に近い宣言です。書き込み先のフォーマットとアクセスを型に含めます。この例のstorage textureはwrite専用です。

### Compute PSOとバインド

```javascript
computePipeline = await device.createComputePipelineAsync({
  layout: 'auto', compute: { module: historyShader, entryPoint: 'computeMain' },
});
```

Compute専用のパイプラインです。Render Pipelineのvertex・fragmentの代わりにcomputeを設定します。シェーダー宣言から推論したLayoutをgetBindGroupLayout(0)で取り出し、シーン、前の履歴、次の履歴、uniformをバインドします。

```javascript
{ binding: 1, resource: histories[index].createView() },
{ binding: 2, resource: histories[1 - index].createView() },
```

2つのBind Groupを作る部分の抜粋です。Aを読んでBへ書くものと、Bを読んでAへ書くものを事前に作り、フレームごとに選びます。

### Dispatch

```javascript
compute.setPipeline(computePipeline);
compute.setBindGroup(0, computeGroups[readIndex]);
compute.dispatchWorkgroups(Math.ceil(width / 8), Math.ceil(height / 8));
```

beginComputePassで開始したCompute PassへPSOとリソースを設定し、Dispatchします。引数はスレッド数ではなくグループ数です。320×180に対して40×23グループを使います。

```wgsl
@compute @workgroup_size(8, 8, 1)
fn computeMain(@builtin(global_invocation_id) id: vec3u) {
```

HLSLの[numthreads(8,8,1)]とSV_DispatchThreadIDに近い組み合わせです。1 invocationが1画素を担当します。Zのグループ数はJavaScript側で省略し、既定値1を使います。

```wgsl
let size = textureDimensions(nextTexture);
if (any(id.xy >= size)) { return; }
```

高さ180は8で割り切れず、Dispatchは184行まで覆います。余った4行のinvocationをここで終了させます。このカーネルにはworkgroup barrierがないため、この早期returnでグループ内同期を分岐させる問題はありません。

### ブラーと減衰

```wgsl
let q = clamp(p + vec2i(x, y), vec2i(0), vec2i(size) - 1);
history += textureLoad(previousTexture, q, 0).rgb * weights[u32(x + 1)] * weights[u32(y + 1)];
```

9点を読むループ内の抜粋です。Test03と同じ1:2:1の重みですが、UVとSamplerを使わず、HLSLのLoadに近いtextureLoadで整数座標のテクセルを直接取得します。端は整数座標でクランプします。

```wgsl
let retention = exp2(-options.y / options.z);
let color = min(history / 16.0 * retention + scene * options.y * 12.0, vec3f(1.0));
textureStore(nextTexture, p, vec4f(color, 1.0));
```

options.yが経過秒、zが半減時間です。履歴を正規化・減衰させ、現在のシーンを経過時間に比例した強さで加えます。12はこのデモの発光の強さです。rgba8unormへ保存するので1でクランプします。textureStoreはUAVへの画素書き込みに近い操作です。

### 次フレームへ切り替え

```javascript
present.setBindGroup(0, presentGroups[writeIndex]);
readIndex = writeIndex;
```

このフレームで書いた履歴を表示し、submit後に次フレームの読み取り元へ切り替えます。両行の間にはdraw・end・submitがあります。CPUへのReadbackは行いません。

## フレームをまたぐ履歴と同期

```text
フレームN    Scene → Compute（Aを読む → Bへ書く）→ Bを表示
フレームN+1  Scene → Compute（Bを読む → Aへ書く）→ Aを表示
```

ブラーは隣の画素を読みます。同じテクスチャをその場で更新すると、別のinvocationが先に書いた結果を読む可能性があり、計算順序に依存してしまいます。2枚を使うことで、全画素が同じ前フレームを参照できます。workgroupBarrierでは異なるグループ間の同期を解決できません。

Scene Render Pass、Compute Pass、Present Render Passを同じCommand Encoderへ順に記録します。WebGPUが用途を検証し、必要なリソース遷移・同期を扱います。D3D12のResourceBarrierやUAV barrierを直接記述するAPIではありません。CPU側で毎フレームGPU完了を待つ必要もありません。

履歴のクリアは2枚へRender Passのclearを記録します。このため履歴にRENDER_ATTACHMENTも付けています。初回の描画はvalidation error scopeとGPU完了待ちで確認し、連続描画中のエラーやdevice lostも状態欄へ表示します。

## 半減時間とブラーの違い

減衰係数は2の負の経過時間乗なので、理想的には半減時間ぶん経過すると履歴の値が半分になります。ただし画素ごとの見た目にはブラー、発光の加算、8ビット量子化、上限のクランプも影響します。

ブラーは毎フレーム1回の固定3×3処理です。フレームレートが高いほど1秒あたりの拡散回数も増えます。減衰と加算にはdeltaを使っていますが、全体がフレームレートから独立したシミュレーションではありません。低負荷なCompute入門として、共有メモリや分離型ブラーによる最適化は行いません。

## 期待される結果

青、紫、黄の光点が別々の軌道を動き、ぼけた軌跡を残します。半減時間を長くすると軌跡が残り、短くすると消えやすくなります。停止すると画像が静止し、履歴クリアで光点だけに戻ります。再開すると再び軌跡が伸びます。

## 制約

WebGPU対応ブラウザとHTTPSまたはlocalhostが必要です。内部320×180を960×540のCanvasへ線形拡大します。固定解像度・8ビットの履歴で、HDR、リサイズ、物理シミュレーションは扱いません。画像素材やサムネイルは追加していません。

[WGSL仕様のCompute Shader](https://www.w3.org/TR/WGSL/#compute-shaders)と[WebGPU仕様](https://www.w3.org/TR/webgpu/)を参照できます。
