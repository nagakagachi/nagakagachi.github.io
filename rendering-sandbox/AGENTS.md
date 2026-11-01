# Rust RenderingSandbox

- v04/はv04の製品ソースの正本。将来の版は別crateへ追加し、公開済み版を暗黙に更新しない。共有workspaceには固定toolchainとCargo.lockを置く。
- Rust・WGSL・設定ファイルはUTF-8 BOMなし・CRLF。MarkdownはUTF-8 BOM付き・CRLF。コードコメントは日本語。
- WebGL/Glow/GLESを有効にしない。実行はWebGPUとWindows DX12。Features/Limitsで能力を確認する。
- 共通レンダラはegui/DOMに依存しない。ウィンドウ・入力・非同期起床・Surfaceとegui合成はhost層が担当する。
- ZPre→CSM→Forward HDR→PostProcess→egui。共通ZOnly、Reversed Z、PreExposureを維持。opaqueのPSにdiscard/clip/深度出力を入れない。
- GPU配置・カリング・LOD・Indirectの決定をCPU読み戻しへ移さない。Modelerの静的配置と初期モデル生成はCPUでよい。
- グローバルAtomicはSubgroup/Workgroup圧縮後の予約に限定。可視リスト容量は候補数×LOD数を必ず覆う。
- CPU/GPUの共有構造体はrepr(C)とPodに加えサイズ/オフセットのテストを持つ。バッファ更新・使用フラグを明示する。
- 対話実行でGPU完了を同期waitしない。タイムスタンプと統計は非同期。連続描画OFFの静止時と非表示時は描画を停止し、eguiの遅延要求を即時化してループさせない。
- GPU Frameはegui末尾までを含める。計測非対応・全スロット使用中でも描画を続ける。計測値の更新だけで新しい計測を要求しない。
- UI追加時は設定型・安定ID・入力の優先配分・フォント文字集合を確認。重いGPU処理をeguiのレイアウト中に発行しない。
- build.rsはWGSLのBOMと不正UTF-8を名前付きでエラーにする。変換して回避しない。
- target/、生成JS/Wasm、ログはコミットしない。成果物はtools/build_rust.pyでリポジトリ外へ生成する。
