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

# リニアワークフロー

- 直接光・SkyLight・大気散乱はシーンリニアHDRで計算・合成する。計算途中で0〜1へ飽和、Tonemapping、ガンマ変換しない。
- アルベドはリニア反射率。将来sRGBテクスチャを入力するときは、サンプリング時にリニアへ復号する。法線・ラフネス等のデータテクスチャはsRGBとして扱わない。
- Octahedral Map・SHは露出やTonemapping前の線形放射輝度を保持する。
- ForwardShadingPassの地形・モデル・天球はrgba16floatのシーンリニアHDRターゲットへ出力する。シェーディングPass内でTonemapping・表示色変換しない。
- 独立したPostProcessPassでのみHDRターゲットを読み、露出 → Tonemapping → 表示色変換 → Canvas出力とする。sRGB Attachmentを導入するときは手動変換との二重適用を防ぐ。
- 現時点の材質は正規化Lambertの拡散反射のみ。GGXスペキュラ等を実装済みと説明しない。

- tests/post-process.htmlで独立した表示Passを検証し、tests/rendering-sandbox.htmlでForwardのrgba16float出力が1超の線形値を保持することを検証する。
