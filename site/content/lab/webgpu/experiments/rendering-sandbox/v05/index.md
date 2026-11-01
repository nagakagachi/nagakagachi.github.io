---
title: "RenderingSandbox v05"
date: "2026-11-01"
lastmod: "2026-11-01T23:13:33+09:00"
draft: false
layout: "rust-sandbox"
description: "Screen Space ShadowのベースラインとGPU計測・比較環境"
---

CSMで不足する近距離のコンタクトと、CSMが届かない遠距離の影を、メインビューの深度を使うScreen Space Shadowで補います。距離対応と旧来の固定レイを切り替え、品質とコストを比較できます。

## Screen Space Shadow

ZPrePass → Screen Shadow Trace → CSM → Forward HDR → PostProcess → eguiの順です。WebGPUでは同じQueueに順に送信し、独立した非同期Computeで動かしているとは扱いません。

Traceは各対象画素からDirectional Lightへワールド空間でサンプルを配置し、毎回投影して深度を参照します。既定ONのInterleaved Gradient Noise（IGN）で、画素ごとにサンプル列の位相を1ステップ幅内でずらし、規則的な縞やブロック状の誤差を分散します。光源方向やステップ数は変えません。フレーム番号を使わない静的ジッターで、OFFでは従来の区間中央サンプルへ戻せます。Infinity-far Reversed Zの深度から位置を復元し、交差判定はビューZのm単位の厚みで行います。始点バイアスは光源方向の距離です。法線バッファは追加しません。

既定はフル解像度・16ステップ・レイ長64m・基準厚み0.2m・始点バイアス0.02mです。等倍/縦横1/2/縦横1/4と4/8/16ステップを選択できます。1080pで縦横1/4・8ステップなら、論理的な深度参照数の上限は約1.04M/Frameです。始点の深度取得は別に1回/対象画素あり、空の除外・交差や画面外での終了により実際の回数は変わります。

## サンプル位置と合成の処理

```wgsl
let phase = select(0.5, interleavedGradientNoise(originPixel), ss.display.w != 0u);
let distance = ss.trace.z + mix(lo, hi, phase);
```

各画素のIGNで区間内の位置を決め、始点バイアスを加えます。lo/hiは初期の細かい区間か、後半の二次配置の区間です。ノイズテクスチャは追加せず、静止時は同じ位置を使います。

```wgsl
let contact = min(csm, value.y);
return mix(contact, value.x, weight);
```

value.yは短距離のコンタクト、value.xはレイ全体の可視率です。Forwardの直射光へ適用する前に、CSMと合成します。weightはCSM終端の90%から1へ遷移し、遠方ではレイ全体の可視率を使います。

## 距離に応じたサンプリング

距離対応は既定ONです。視点からの線形深度をzとして、scale=max(1,z/基準距離)で後半のレイを拡張します。既定の基準距離は128m、最大レイ長は8192mです。例えばz=128mまでは64m、z=1024mで512m、z=8192mで4096mのレイになります。

最初4ステップは、視点距離に関係なく0.25m間隔を維持します。最初から遠景用の大きな間隔で進んで、近い遮蔽物を飛び越えるのを抑えるためです。残り12ステップは、初期区間の終端からレイ終端までを二次分布で配置します。ステップ数自体は増やしません。IGNは各区間の中でサンプル位置をずらします。

厚みも距離に応じて緩和します。後半の判定幅は「基準厚み×scale＋区間幅×係数」を最大厚みで制限します。既定の係数は0.5、最大厚みは256mです。最初の細かい区間には基準厚みだけを使い、近景の接触部を遠景用の大きな許容幅で潰さないようにします。厚みは深度表面の背後にどれだけ侵入しても交差とみなすか、という近似です。緩和しすぎると別の物体や斜面を誤って遮蔽物と判断します。

距離対応OFFでは、従来の等間隔レイ・固定厚みへ戻ります。初期ステップ数、初期間隔、基準距離、最大レイ長、最大厚み、区間幅の係数をUIで変更できます。

## CSMとの合成

1本のレイから、全体の可視率と最初の細かい区間だけの可視率を同時に得ます。CSM範囲内はmin(CSM,contact)で細かいコンタクトを補完し、CSM終端距離の90%から全体の可視率へ補間して、遠景の影へ切り替えます。直射光だけへ適用し、SkyLightには掛けません。

全体の可視率は既存マスクのR、コンタクトはAへ格納します。追加テクスチャや2本目のレイは使いません。「近景にも長距離成分を合成」は全体の可視率を近景でも適用する比較モードです。CSMがOFFの場合も全体の可視率を使います。

## 可視化と比較

パラメータUIは「ライト」と「シャドウ」を分けています。「シャドウ」の下に「ディレクショナルシャドウ」（CSM・バイアス・PCF・キャスターカリング）と「Screen Space Shadow」を置いています。

可視率マスク、コンタクトマスク、深度参照数、終了理由をメイン画面へ表示できます。終了理由は赤が交差、緑が未交差、青が画面外/投影範囲外、灰が旧固定モードで除外したCSM範囲内、黒が空です。CSMのみ/Screen Space Shadowのみ/合成の比較も可能です。合成切替ではTraceを継続するため、GPU負荷を比較するときはScreen Space Shadow自体をOFFにしてください。

低解像度マスクはPointまたは4tapのBilinearで参照します。初版には深度境界を考慮した再構成や時間蓄積を入れていません。Bilinearは境界をまたいで影を混ぜるため、シルエット付近で漏れが生じます。

## GPU計測

GPU Frameとパス別の最新値・中央値・P95を、直近240サンプルで表示します。条件を変更すると統計をリセットし、30サンプルのウォームアップを除外します。樹木の生成が完了した時も統計をリセットします。結果は非同期で取得し、GPU完了を対話描画で同期waitしません。計測非対応環境では非対応と表示します。

設定・カメラ・描画解像度をA/Bとして保存・復帰できます。比較時にはカメラと太陽の移動を止め、樹木の配置生成完了後に測定してください。CPU時間・Present待ちはGPU Frameへ含みません。

診断カウンタは任意ONです。Traceした画素数、始点を含む実際の深度参照数、交差数、画面外終了数をWorkgroup内で縮約し、大域Atomicは1Workgroupにつき最大4回に限定します。診断は描画結果を変えませんが計測負荷は加わるため、通常の時間比較ではOFFにします。参照回数はDRAM転送量やキャッシュミスの測定ではありません。

## TODOと既知の問題

- [ ] **Screen Space Shadowの自己遮蔽的なアーティファクトの原因を切り分け、低減する。** 現在の表示で目立つことを確認しており、この版では未修正です。

## 制限と次の検討

画面外や手前の物体に隠れた遮蔽物は復元できません。少数ステップは薄い遮蔽物を見落とし、単一深度＋厚みの近似は誤遮蔽も起こします。この版は完成形の性能や品質を保証するものではありません。

Blue Noise、時間蓄積、Hi-Z、深度サンプル共有は未実装です。今後、前処理と再構成のコストも含め、この基準実装と比較します。

IGNの参考：[Interleaved Gradient Noise — Alan Wolfe](https://blog.demofox.org/2022/01/01/interleaved-gradient-noise-a-different-kind-of-low-discrepancy-sequence/)

[前版v04](../v04/) · [v05ソース（GitHub）](https://github.com/nagakagachi/nagakagachi.github.io/tree/main/rendering-sandbox/v05)


## 参考資料

- [Unity HDRP ContactShadows.compute](https://github.com/Unity-Technologies/Graphics/blob/master/Packages/com.unity.render-pipelines.high-definition/Runtime/Lighting/Shadow/ContactShadows.compute)：視点深度に応じたレイ長、IGN、交差の許容幅
- [Tomasz Stachowiak — Depth buffer raymarching](https://gist.github.com/h3r2tic/9c8356bdaefbe80b1a22ae0aaee192db)：非線形サンプル配置、レイ長・ステップ数と厚みの関係

この版は、それらを参考にした独自の組み合わせです。HDRPやBend Studioのアルゴリズムをそのまま移植したものではありません。初期細分化でも全ての薄い遮蔽物を保証できず、IGNだけではノイズは消えません。
