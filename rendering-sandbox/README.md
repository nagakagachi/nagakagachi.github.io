# RenderingSandboxのRust実装

版ごとに独立したcrateを置くCargo workspace。v04の正本はv04/であり、公開済みv03のTypeScriptは変更しない。将来の版から実行時に過去版のソースを参照しない。

## 実行

Rust 1.99.1、wgpu 27.0.1、egui/egui-wgpu/egui-winit 0.33.0、wasm-bindgen-cli 0.2.105を固定。Cargo.lockは追跡し、target/は追跡しない。WebGL/Glow/GLESは有効化しない。WindowsはDX12、WebはブラウザのWebGPUを選ぶ。

Windows版：

```powershell
cargo +1.99.1 run --manifest-path rendering-sandbox/Cargo.toml --locked --bin sandbox-v04
```

Wasm生成：

```powershell
rustup target add wasm32-unknown-unknown --toolchain 1.99.1
cargo +1.99.1 install wasm-bindgen-cli --version 0.2.105 --locked
python tools/build_rust.py --destination <リポジトリ外の作業用出力先>
```

サイト全体は従来のtools/build_site.pyを使う。--draftsではv04もWasm生成し、site/contentの一時コピーにJS/Wasmを配置する。通常の公開ビルドはv04が下書きの間はRust生成を省略する。v04のdraftを解除するとRust生成が必須になり、Pages Actionsもツールを準備する。生成JS/Wasmはコミットしない。

本セッションでは既存環境を変更しないため、RustはOS一時ディレクトリのnagamushi-rust-tools/{cargo,rustup}へ導入した。通常のcargoがPATHにない場合はこのディレクトリとCARGO_HOME/RUSTUP_HOMEを指定する。ユーザーのグローバルPATHやRust設定は変更していない。

## 構成

- v04/src/host.rs：起動、Surface、入力、イベントループ、egui合成。プラットフォーム差分は主にこの層
- v04/src/host/inspector.rs：eguiの設定・デバッグUI
- v04/src/scene.rs：設定、カメラ、CPU/GPU Uniform、CSM行列とShadowCasterVolumeCulling
- v04/src/renderer.rs：描画パスとリソースの接続
- v04/src/height.rs：FP16 Height Clipmapの差分更新
- v04/src/sky.rs：Sky Octahedral、2次SH、GGX Prefilter、BRDF LUT
- v04/src/models.rs：枝葉・骨格・幹・LODのCPU生成。DOM/GPUには依存しない
- v04/src/foliage.rs：GPU配置、可視リスト、LOD別Indirect Draw、Modelerの静的配置
- v04/src/profiler.rs：非同期GPUタイムスタンプ
- v04/src/shaders/：v04用WGSLの正本。v03を移植元として意図的に継承した製品ソース。実行時にv03を参照しない

レンダラはeguiに依存しない。出力は非sRGBのRGBA8テクスチャで、ACES Filmic後に一度だけsRGB符号化する。eguiはこのLDR画像をSurfaceへ合成する。HDRやカメラ露出をUIへ適用しない。Surfaceも非sRGB形式を選び二重変換を避ける。

eframeは使っていない。GPU Frameを最初のパスからegui末尾まで計測し、描画順・読戻し・静止時の停止を明示的に所有するためwinit＋egui-wgpuを採用した。

## GPU計測

TIMESTAMP_QUERYがある場合のみ有効化。4スロット、各スロット最大16区間。スロットが全て使用中なら計測のみ省略し、描画は待たない。各パスの先頭/末尾を書き、先頭のマーカーからegui末尾までの区間をGPU Frameとする。Queueのtimestamp periodでnsへ換算しms表示する。

結果はmap_asyncで非同期取得。GPU Frameは指数移動平均（新しい値20%）、個別パスは最新値。CPU処理、Queueへの転送、Present待ちは含まない。パス間のGPU待ち時間を含むため各パスの和と同じではない。連続描画は既定ONで、表示更新に合わせて毎フレーム描画する。OFFでは操作・生成などが必要な時だけ描画し、停止中は最後の計測値を保持する。3DビューはUIを除く領域に16:9で収める。統計表示のための再描画から無限に再計測しない。利用不可では「計測非対応」と表示する。

今はTerrain Cull・Foliage生成/Cull・ZPre・CSM・Forward/Sky・Post・eguiの区間を記録。Height生成やSky/SH/PrefilterもGPU Frame範囲には含まれるが個別区間はまだ分離していない。GPU占有率、演算器稼働時間、独立した非同期Computeキューの計測ではない。

## 検証

```powershell
cargo +1.99.1 test --manifest-path rendering-sandbox/Cargo.toml --locked --lib
cargo +1.99.1 run --manifest-path rendering-sandbox/Cargo.toml --locked --bin sandbox-v04 -- --smoke
cargo +1.99.1 run --manifest-path rendering-sandbox/Cargo.toml --locked --bin sandbox-v04 -- --smoke --no-timestamps --workgroup
```

--smokeはWindows DX12の実GPUで、配置生成完了・4LOD固定・表示OFF・Modeler・LOD横並び・リソース可視化を検査する。この無人検証モードだけでGPU完了待ちを使用する。対話実行では同期waitを行わない。CIではGPUハードウェアを前提にせず、CPU/シェーダ検査と両ターゲットのビルドを実行する。

## 移行の範囲と差

v03の描画技法と標高シード・振幅・山スケール、近中景CSM設定を引き継ぐ。Rustのモデル生成はf32演算のため、TSのNumberによる計算とビット単位の一致は保証しない。低LODの代表選択で同距離になる場合の順序も差があり得る。共有トポロジ・Tri予算・生成規則・パラメータは維持する。画像のピクセル完全一致を検証した移行ではない。

Modelerは同じアプリ内で切り替える。樹木・枝葉部品・LOD横並び、クラス3種、バリエーション4種、樹形6種、最大主要枝3本、CPU配置1〜100本、幹3LOD、枝葉4LODを扱う。森林の配置はGPU、Modelerの静的配置はCPU。Modelerの複数配置は3seed形状を共有する。正面/斜め/上面ボタンとシルエット表示にも対応。全クラス同時比較はまだ移していない。Modelerも現在はフライカメラで操作する。

GPUフレーム時間以外の性能比較、全UI組合せ、長時間実行、実機スマホ、デバイスロストからの自動復帰は未検証。過去のv03は比較用としてそのまま残す。v04はサイトから利用できる公開版とする。

## 日本語フォント

v04/assets/NotoSansJP-UI.ttfはNoto Sans JPのUI文字だけを残した派生フォント。SIL Open Font Licenseは同ディレクトリのOFL.txtを参照。元データはhttps://github.com/google/fonts/tree/main/ofl/notosansjp 。UIへ漢字を追加した場合はtools/subset_sandbox_font.pyで再生成する。追加フォントはRustに埋め込み、外部サービスから実行時に取得しない。

```powershell
python -m pip install fonttools==4.68.0
python tools/subset_sandbox_font.py <取得したNotoSansJPのTTF>
```


3Dの描画解像度は「描画」から選びます。既定のAutoは表示領域とDPIに追従し、1920×1080を上限とします。720p・1080p・1440p・2160pの固定指定も可能です。いずれも16:9で、eguiの解像度は変更しません。

Web版はCSSがCanvasの表示サイズを所有する。起動時のwith_inner_sizeや実行中のrequest_inner_sizeはCSSを固定pxへ書き換えるため使用しない。winit内蔵ResizeObserver → Resized → Surface再設定 → eguiレイアウト → 3D用RT再設定の順で追従する。Autoだけが表示サイズに合わせて変化し、固定解像度は維持する。
