"""Rustの正本からWasm配布物を生成する。出力は指定された作業用ディレクトリのみ。"""
import argparse
from pathlib import Path
import shutil
import subprocess


def build(output):
    repository = Path(__file__).resolve().parents[1]
    workspace = repository / 'rendering-sandbox'
    output = Path(output).resolve()
    if repository == output or repository in output.parents:
        raise ValueError('出力先にはリポジトリ外の専用ディレクトリを指定してください')
    cargo = shutil.which('cargo')
    bindgen = shutil.which('wasm-bindgen')
    if not cargo or not bindgen:
        raise RuntimeError('cargoとwasm-bindgen-cli 0.2.105をPATHへ追加してください。rendering-sandbox/README.mdを参照')
    version = subprocess.check_output([bindgen, '--version'], text=True).strip()
    if version != 'wasm-bindgen 0.2.105':
        raise RuntimeError(f'wasm-bindgen-cliの版が不一致です: {version}')
    subprocess.run([cargo, 'build', '--locked', '--release', '--package', 'rendering-sandbox-v04', '--lib', '--target', 'wasm32-unknown-unknown'], cwd=workspace, check=True)
    output.mkdir(parents=True, exist_ok=True)
    subprocess.run([bindgen, str(workspace / 'target/wasm32-unknown-unknown/release/rendering_sandbox_v04.wasm'), '--target', 'web', '--no-typescript', '--out-dir', str(output), '--out-name', 'sandbox'], cwd=workspace, check=True)
    return output


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--destination', required=True, type=Path)
    build(parser.parse_args().destination)
