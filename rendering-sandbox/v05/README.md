# RenderingSandbox v05

PolarShadowCacheによる遠距離シャドウの検証版です。

- polar_shadow.rsとshaders/polar-shadow-*.wgslで深度転写、履歴、フィルタ、デバッグを管理します。
- キャスターバイアスは固定押し込み、セル寸法補正倍率、上限の3項目です。
- ScreenSpaceShadowは削除済みです。
- ビルドと実行は親のREADME.mdを参照してください。
- 履歴のテクセル中心からの再投影による位置ずれと穴抜けは検証中です。
