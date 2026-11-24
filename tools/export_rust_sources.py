"""Rust/WGSLの正本から、Hugoのソース閲覧用リソースを生成する。"""
import json
from pathlib import Path
import re
import subprocess

GITHUB = 'https://github.com/nagakagachi/nagakagachi.github.io'
LANGUAGES = {'.rs': 'rust', '.wgsl': 'wgsl', '.toml': 'toml', '.lock': 'toml', '.md': 'markdown'}


def export_sources(repository, bundle, version):
    repository, bundle = Path(repository).resolve(), Path(bundle).resolve()
    canonical = repository / 'rendering-sandbox' / version
    if not re.fullmatch(r'v[0-9]+', version) or not (canonical / 'src').is_dir():
        raise ValueError(f'Rustソースが見つかりません: {version}')
    if bundle == repository or repository in bundle.parents:
        raise ValueError('生成先はリポジトリ外のビルド用ディレクトリにしてください')
    revision = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=repository, text=True).strip()
    if not re.fullmatch(r'[0-9a-f]{40}', revision):
        raise ValueError('公開ソースのコミットSHAを取得できません')
    # 明示したソースだけを公開する。キャッシュ・フォント・ビルド生成物は対象外。
    listed = subprocess.check_output(
        ['git', 'ls-files', '--cached', '--others', '--exclude-standard', '-z', '--',
         (canonical / 'src').relative_to(repository).as_posix()], cwd=repository).decode('utf-8')
    paths = {}
    for relative in filter(None, listed.split('\0')):
        p = repository / relative
        if p.is_file() and p.suffix in ('.rs', '.wgsl'):
            paths[p.relative_to(canonical).as_posix()] = p
    for name in ('Cargo.toml', 'README.md'):
        if (canonical / name).is_file():
            paths[name] = canonical / name
    for name in ('Cargo.toml', 'Cargo.lock', 'rust-toolchain.toml', 'README.md'):
        p = repository / 'rendering-sandbox' / name
        if p.is_file():
            paths['workspace/' + name] = p
    relative_paths = [p.relative_to(repository).as_posix() for p in paths.values()]
    dirty = bool(subprocess.check_output(
        ['git', 'status', '--porcelain', '--untracked-files=all', '--', *relative_paths], cwd=repository))
    names = {p.resolve(): name for name, p in paths.items()}
    entries = []
    for name, source in sorted(paths.items()):
        if not source.resolve().is_relative_to(repository):
            raise ValueError(f'リポジトリ外のソースは公開できません: {source}')
        data = source.read_bytes()
        if source.suffix == '.wgsl' and data.startswith(b'\xef\xbb\xbf'):
            raise ValueError(f'{source}: WGSLにUTF-8 BOMが付いています')
        try:
            text = data.decode('utf-8')
        except UnicodeDecodeError as error:
            raise ValueError(f'{source}: 不正なUTF-8です') from error
        resource = 'code/' + name + '.txt'
        output = bundle / resource
        output.parent.mkdir(parents=True, exist_ok=True)
        # 直接表示・保存する原文は、BOMと改行を含めて正本のバイト列を維持する。
        output.write_bytes(data)
        includes = []
        if source.suffix == '.rs':
            for literal in re.findall(r'include_str!\(\s*"([^"]+)"\s*\)', text):
                target = names.get((source.parent / literal).resolve())
                if target and target not in includes:
                    includes.append(target)
        entries.append({'path': name, 'resource': resource,
                        'repository_path': source.relative_to(repository).as_posix(),
                        'language': LANGUAGES[source.suffix], 'includes': includes})
    manifest = {'version': version, 'revision': revision, 'dirty': dirty, 'github': GITHUB,
                'repository_path': canonical.relative_to(repository).as_posix(), 'files': entries}
    bundle.mkdir(parents=True, exist_ok=True)
    (bundle / 'source-manifest.json').write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + '\n', encoding='utf-8', newline='\n')
    return manifest
