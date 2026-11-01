fn main() -> Result<(), Box<dyn std::error::Error>> {
    #[cfg(not(target_arch = "wasm32"))]
    env_logger::init();
    #[cfg(not(target_arch = "wasm32"))]
    if std::env::args().any(|arg| arg == "--smoke") {
        return rendering_sandbox_v04::smoke();
    }
    rendering_sandbox_v04::run()
}
