---
title: "RenderingSandbox v04"
date: "2026-11-01"
draft: false
layout: "rust-sandbox"
preview: "preview.webp"
preview_caption: "実行時の表示例（共通RustレンダラのWindows版）"
description: "Rust・wgpu・eguiによるWebとWindows共通レンダラの移行検証"
---

Rust・wgpu・eguiへ移行した版です。WebGPUとWindows DX12で共通の描画処理を使います。WebGLは対象外です。

GPU Frameは最初のGPUパスからegui描画末尾までの区間時間をmsで示します。非同期で取得した平滑値で、CPU処理・画面表示待ちは含みません。停止中は最終計測値を保持し、非対応環境では計測非対応と表示します。

## Rustへの移行

描画処理と設定UIをRustへ移し、ブラウザ版はWasm＋WebGPU、Windows版はDX12で動かします。UIにはeguiを使い、起動とイベント処理はwinitが担当します。ブラウザ側のJavaScriptはWasmの読み込みだけです。

地形のHeight Clipmap、GPUカリングとIndirect Draw、4段CSM、Sky・2次SH・Octahedral Specular IBL、HDR描画とPreExposure、ACES Tonemappingを引き継ぎます。樹木の配置・LODと、枝葉・幹の共有IB＋Storage VBによる描画もRust側で扱います。

画面内でRendererとModelerを切り替えます。Modelerでは樹形・枝葉クラス・形状バリエーション・LODを確認できます。WASDで前後左右、Q/Eで上下、ドラッグで回転します。Shiftで移動を加速します。

## GPU時間の計測

GPUタイムスタンプに対応する環境ではGPU Frameとパス別の時間を表示します。4組の読戻しバッファを順に使い、結果を非同期取得します。全て使用中ならそのフレームの計測を省略し、描画を待たせません。

GPU FrameにはHeight・Skyの更新、カリング、各描画パス、eguiの描画を含みます。転送処理・CPU時間・Present待ちは含みません。パス別表示ではHeight・Sky更新の内訳をまだ分離していません。連続描画は既定でONです。表示更新に合わせて毎フレーム描画します。OFFでは静止時の描画を止め、最後の計測値を保持します。3Dビューは16:9を維持します。

## 移行時の差と検証範囲

v03は変更せず比較用に残します。モデル生成の演算精度や代表形状の選択順に差があるため、ピクセル単位で同一の絵を保証する移植ではありません。Modelerの全クラス同時比較は未対応です。

Windows DX12での描画検証、Wasmビルド、データ構造とシェーダの検査を実施しています。長時間動作や実機スマートフォンは未検証です。


3Dの描画解像度は「描画」から選びます。既定のAutoは表示領域とDPIに追従し、1920×1080を上限とします。720p・1080p・1440p・2160pの固定指定も可能です。いずれも16:9で、eguiの解像度は変更しません。


## ソース

[共通レンダラ・Modeler・WGSL（GitHub）](https://github.com/nagakagachi/nagakagachi.github.io/tree/main/rendering-sandbox/v04) · [ビルドと実行手順](https://github.com/nagakagachi/nagakagachi.github.io/blob/main/rendering-sandbox/README.md)
