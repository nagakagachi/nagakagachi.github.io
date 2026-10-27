---
build:
  render: never
  list: never
---

# v01の扱い

- 2026-10-27に公開した保存版。実行コードを固定し、次の開発は別の版で行う。
- この版のフォルダ内だけで実装を完結させる。v00や親へ実行ソースを移して共有しない。
- 実行コードを変更する場合は、この公開版を修正する明示的な指示を確認する。
- URL・日付・版間ナビゲーションなどの管理情報は、実装変更と区別する。
- 親のAGENTS.mdの描画・検証・文字形式の規約を引き継ぐ。

# HDRレンダリング

- 直接光・SkyLight・大気散乱はシーンリニアHDRで計算・合成する。計算途中で0〜1へ飽和、Tonemapping、ガンマ変換しない。
- アルベドはリニア反射率。将来sRGBテクスチャを入力するときは、サンプリング時にリニアへ復号する。法線・ラフネス等のデータテクスチャはsRGBとして扱わない。
- Octahedral Map・SHは露出やTonemapping前の線形放射輝度を保持する。デバッグ表示時のコピーだけにカメラのPreExposureを適用する。
- ForwardShadingPassの地形・モデル・天球はrgba16floatのシーンリニアHDRターゲットへ出力する。シェーディングPass内でTonemapping・表示色変換しない。
- カメラのPreExposureをForward・天球のPS出力最終段で一度だけ適用し、HDRターゲットに保持する。露出はカメラ設定に属する。
- 独立したPostProcessPassはPreExposure済みHDRを読み、Tonemapping → 表示色変換 → Canvas出力とする。露出を再適用しない。sRGB Attachmentを導入するときは手動変換との二重適用を防ぐ。
- 現時点の材質は正規化Lambertの拡散反射のみ。GGXスペキュラ等を実装済みと説明しない。

- tests/post-process.htmlで独立した表示Passを検証し、tests/rendering-sandbox.htmlでForwardのrgba16float出力が1超の線形値を保持することを検証する。

- カメラ画角はメイン投影と天空のピクセルレイで一致させる。Camera Uniformの前回PreExposureと履歴変換比は、将来の履歴HDRの尺度整合用に維持する。

- 本文では照明計算とHDR出力の枠組みを「HDRレンダリング」と呼ぶ。「リニアワークフロー」はコンテンツ制作を含む文脈のため、この説明の呼称に使わない。PreExposureの説明は一般的な目的と本実装の採用範囲を簡潔に示す。

- Sky Octahedral MapはPBRT等と同じ+Z極・XY展開を使う。ワールドはY-upのまま軸を交換しない。UV中心+Z、四隅-Z、V下向きで画像上辺-Y・下辺+Y。生成とSH投影はsky-octahedral.wgslを共有し、デバッグ表示に追加のV反転を入れない。

- カメラ露出UIはEV100（−10〜15）とし、PreExposure=2^(-EV100)へ換算する。EV増加で暗くする。露出補正EVや線形倍率と混同しない。レンズ校正係数は1、既定EV100は0。光源の物理単位による校正は未実装。

- 地形スナップは交互対角線IBの周期に合わせて各LODの2セル単位とする。接続帯は8行で粗格子の接続先を共有する頂点に同じ変形重みを与える。tests/rendering-sandbox-grid.test.mjsで移動時の世界セル分割不変と3Dでのクラック・面反転・縮退を検証する。
