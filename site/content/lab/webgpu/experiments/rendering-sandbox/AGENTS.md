---
build:
  render: never
  list: never
---

# RenderingSandboxの制作規約

- 正本はこのフォルダ。TerrainRendering00から派生した独立した実験環境であり、元実験のファイルをimport/fetchしない。複製したソースも今後はこの実験が所有する。
- 描画PassはZPrePass → ShadowPass → ForwardShadingPassの順序を維持する。メイン深度を先に確定し、将来のSSAO等が参照できる構造にする。
- この実験内では位置計算・視点情報・描画Pass等を共通化する。モデルを追加するときは`render-passes.ts`の`OpaqueRenderable`契約へ登録する。
- 不透明物は位置専用のZOnlyとForwardのバリエーションを持つ。ZOnlyはZPrePassとShadowPassで共有し、視点ごとのUniform・可視リストだけを変える。深度のみのPipelineにPSを追加しない。
- ZOnlyとForwardの頂点位置は同じ原本から計算し、位置出力に`invariant`を付ける。Forwardは深度ReadOnly・Equal比較・深度書込なしを維持する。頂点変形の追加も両経路に同じ規則を適用する。
- 不透明PSでdiscard/clip、深度出力、Storage書込を行わない。表現上必要な例外はユーザーと相談し、パスを明確に分ける。
- MainとShadowのカリングは独立したUniform・可視リスト・Indirect引数を持つ。メインで不可視という理由でキャスターを除外しない。複数dispatchの間に同一Uniformへqueue.writeBufferして視点を切り替える実装はしない。
- 地形の位置・標高・LOD接続は`terrain-geometry.wgsl`が原本。両視点で同じ候補タイル配置とFP16 Height Clipmapを参照し、受け手とキャスターの形状を一致させる。
- 可視リストへの領域予約はsubgroupまたはworkgroupで集約する。タイルごとの単一カウンターへのグローバルAtomicへ戻さない。カリングのフリーズは両視点のリスト・配置・標高窓・光源投影をまとめて固定する。
- コメントは日本語。シェーダーはUTF-8 BOMなしとし、BOMや不正UTF-8をロード時に黙って除去・変換しない。例外で対象ファイルを示す。
- 天球の放射輝度は`sky-common.wgsl`を原本とし、背景ピクセルレイとOctahedral生成で共有する。SHはl=0,1の4係数、[定数,X,Y,Z]の基底で統一する。立体角補正とLambert畳み込みを維持し、空が変わらないカメラ操作で再投影しない。
- 追加のGPU資源は終了・再実行・初期化失敗時に破棄する。静止画のために無条件の連続描画を追加しない。
- 検証には`tests/rendering-sandbox.test.mjs`と`tests/rendering-sandbox.html`を使う。後者はOS一時領域の下書きビルド先へ一時配置し、実シェーダーでZPrePassの被覆一致・影の比較方向・視野外キャスターを確認する。`tests/sky-environment.html`では解析解のある空でSHと立体角補正、背景の深度・カメラ対応を確認する。
- 初版は公開済み。公開日とlastmodはindex.mdで管理する。以降の変更のコミット・push・公開はユーザーの指示に従う。
