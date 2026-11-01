# RenderingSandbox v05

v04を保存したまま独立したcrateとして開発する、Screen Space Shadowの基準実装。コメントは日本語、Rust/WGSLはUTF-8 BOMなしCRLF、文書はBOM付きCRLF。

## 実行

```powershell
cargo +1.99.1 run --manifest-path rendering-sandbox/Cargo.toml -p rendering-sandbox-v05 --bin sandbox-v05
cargo +1.99.1 test --manifest-path rendering-sandbox/Cargo.toml -p rendering-sandbox-v05 --lib
cargo +1.99.1 run --manifest-path rendering-sandbox/Cargo.toml -p rendering-sandbox-v05 --bin sandbox-v05 -- --smoke
python tools/build_rust.py --version v05 --destination <リポジトリ外の出力先>
```

Webページはtools/build_site.pyで生成する。v04の生成物・ソースは参照せず、v05内のソースと資源を正本とする。v04からの継承部分の構成はworkspaceのREADME.mdも参照。

## 追加部分

- screen_shadow.rs：リソース、272bytesのUniform、Trace、非同期診断と実GPU検証
- shaders/screen-shadow-*.wgsl：基準のTrace、Forwardへの可視率合成、可視化
- profiler.rs：240件の統計窓、中央値/P95、30件ウォームアップ、設定世代による旧読戻しの除外
- host/inspector.rs：Screen Space Shadow設定、可視化、A/B保存復帰とカメラ固定

MaskはRGBA8Unormの4bytes/texel。Rは可視率、Gは深度参照数/16、Bは終了理由/255、Aは短い初期区間だけのコンタクト可視率。1080pの縦横1/4では480×270、約0.49MiB。別途272bytesのUniformと各16bytesの集計・読戻しバッファ。メイン深度は既存のものを使う。Point/Bilinearでのマスク参照はForward内で行うため、独立した再構成パスはない。Trace以外の合成コストはForward時間へ含む。

診断の読戻しは1スロットで、使用中なら次の診断読戻しだけ省略する。マスク生成は継続しGPU完了を待たない。GPU時間の読戻しは既存の4スロット方式。smokeに限って同期waitし、空・単一平面・既知の遮蔽物、診断ON/OFFの一致、全解像度/合成/可視化を検査する。

アルゴリズムと制限はsite/content/lab/webgpu/experiments/rendering-sandbox/v05/index.mdを参照。この版を公開用のv05として保存する。

既定はフル解像度・16step、IGNジッターON。スクリーン整数座標のIGN値をサンプル列の位相として使い、ステップ数と方向を維持する。フレーム依存はなし。OFFは位相0.5の旧基準。1080pのマスク容量は約7.91MiB、レイ部分の深度参照上限は約33.18M、始点込み約35.25M/Frame。高速化の達成を示す設定ではなく、ユーザー指定の比較基準。


## 距離対応とコンタクト

既定で距離対応をON。scale=max(1,viewZ/128m)、レイ長=min(64m×scale,8192m)。16ステップのうち最初4個は0.25m間隔（計1m）に固定し、残り12個を二次分布の区間で配置する。IGNは各区間内の位置だけを変更する。小ステップ設定でも最後の1個は後半へ残す。

厚みの基準を0.2m、始点biasを0.02mへ変更。初期区間は固定厚みのまま、後半はmin(256m,0.2m×scale+0.5×区間幅)とする。正確な物体の厚みではなく、少数サンプルの見落としを緩和する許容幅。過大な設定は誤遮蔽を増やす。

近景でもTraceし、Mask Aへ初期区間だけの可視率を格納する。CSM範囲内はmin(CSM,contact)、終端10%で全体マスクRへ切替える。同じRGBA8へ詰めるため追加テクスチャはない。統計のTrace画素数は終了理由から算出する。距離対応OFFで旧来の等間隔・固定厚みへ戻せる。

参考はUnity HDRPのContactShadows.compute（視点深度による距離スケール）とTomasz Stachowiakの深度レイマーチ（非線形配置・厚みとの関係）。これらの実装をそのまま移植したものではなく、始点付近の固定区間と後半の二次配置を組み合わせた実験用設計。


## TODO

- [ ] Screen Space Shadowに目立つ自己遮蔽的なアーティファクトがある。原因を切り分けて低減する。v05公開時点では未修正。

厚み・始点バイアス・点サンプルの近似は調査対象だが、原因や解決策はまだ確定していない。既存の描画設定を変更して解決済みとは扱わない。
