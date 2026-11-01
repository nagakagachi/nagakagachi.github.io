"""Build from canonical site sources; disposable staging stays in the OS temp directory."""
import argparse
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
from build_rust import build as build_rust


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--destination', required=True, type=Path)
    parser.add_argument('--hugo', default='hugo')
    parser.add_argument('--drafts', action='store_true')
    args = parser.parse_args()
    repository = Path(__file__).resolve().parents[1]
    destination = args.destination.resolve()
    if destination == Path(destination.anchor) or destination == repository or destination in repository.parents or repository in destination.parents:
        parser.error('Use a dedicated build destination outside the repository')
    compiler = repository / 'node_modules/typescript/bin/tsc'
    if not compiler.is_file():
        parser.error('TypeScript is missing; run npm ci at the repository root')
    # Canonical source is repository/site. This copy is temporary staging, never edited or committed.
    with tempfile.TemporaryDirectory(prefix='nagamushi-build-') as temporary:
        stage = Path(temporary) / 'site'
        shutil.copytree(repository / 'site', stage, ignore=shutil.ignore_patterns('public', 'resources', '.hugo_build.lock'))
        subprocess.run(['node', str(compiler), '--project', str(repository / 'tsconfig.json'),
                        '--outDir', str(stage / 'content')], cwd=repository, check=True)
        # 下書きのRust版は公開ビルドへ混入させない。公開時には生成を必須にする。
        for version in ('v04', 'v05'):
            bundle = Path('content/lab/webgpu/experiments/rendering-sandbox') / version
            rust_page = repository / 'site' / bundle / 'index.md'
            if rust_page.exists() and (args.drafts or 'draft: true' not in rust_page.read_text(encoding='utf-8-sig')):
                generated = build_rust(Path(temporary) / f'rust-web-{version}', version)
                for asset in ('sandbox.js', 'sandbox_bg.wasm'):
                    shutil.copy2(generated / asset, stage / bundle / asset)
        command = [args.hugo, '--source', str(stage), '--destination', str(destination),
                   '--cacheDir', str(Path(temporary) / 'cache'), '--noBuildLock',
                   '--cleanDestinationDir', '--minify', '--panicOnWarning']
        if args.drafts:
            command.append('--buildDrafts')
        subprocess.run(command, cwd=repository, check=True)
        if not args.drafts:
            subprocess.run([sys.executable, str(repository / 'tools/validate_site.py'),
                            str(destination)], cwd=repository, check=True)
    print(f'Built site: {destination}')


if __name__ == '__main__':
    main()
