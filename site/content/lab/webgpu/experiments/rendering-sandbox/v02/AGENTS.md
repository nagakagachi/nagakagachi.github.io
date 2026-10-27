---
build:
  render: never
  list: never
---

# v02の扱い

- 2026-10-28公開の保存版。新しい機能の開発は次の版で行い、この版の動作を変える修正はユーザーの指示に従う。
- 実行資源はこの版内で完結させ、v00・v01を変更しない。
- 親の描画・コメント・文字形式規約を継承する。
- CSMは2048² Atlas内の1024²×4段、Reversed Z。各段の可視リストとUniformは独立。
- PBRはGGX D・非相関Smith G・Schlick F・正規化Lambert。roughnessからalpha=roughness²へ換算。
- 天空・SH・Prefilter Mapは未露出HDR。Forwardの出力最終段でPreExposureを一度適用する。
- Octahedralの極は+Z、ワールドはY-up。端の補間はOctahedralの接続規則で処理する。

- GGX Mapは256²〜16²の5 Mip。各Mipのgutter比率を1/16で固定し、共通UVとハードウェアのトリリニア1参照を維持する。手動Mip混合へ戻さない。
- カリングは光源ボックスと受光フラスタムの光源方向押出し凸体の交差。subgroup/workgroupで可視リストを集約する。最速と断定せず対象規模と検証条件を説明する。
