// シェーダのBOMと不正なUTF-8は、変換せずビルド時のエラーにする。
fn main() {
    let directory = std::path::Path::new("src/shaders");
    for entry in std::fs::read_dir(directory).expect("シェーダディレクトリ") {
        let path = entry.expect("シェーダ項目").path();
        if path.extension().and_then(|s| s.to_str()) != Some("wgsl") {
            continue;
        }
        println!("cargo:rerun-if-changed={}", path.display());
        let bytes = std::fs::read(&path).unwrap_or_else(|e| panic!("{}: {e}", path.display()));
        assert!(
            !bytes.starts_with(&[0xef, 0xbb, 0xbf]),
            "{}: WGSLへBOMを付けないでください",
            path.display()
        );
        std::str::from_utf8(&bytes)
            .unwrap_or_else(|e| panic!("{}: 不正なUTF-8: {e}", path.display()));
    }
}
