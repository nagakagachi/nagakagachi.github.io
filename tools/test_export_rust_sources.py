"""ソース配布の原文保持・公開範囲・コミット対応を検証する。"""
import json
from pathlib import Path
import subprocess
import tempfile
import unittest

from export_rust_sources import export_sources


class SourceExportTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='nagamushi-source-test-')
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.repo = self.root / 'repo'
        self.repo.mkdir()
        self.source = self.repo / 'rendering-sandbox/v05/src'
        (self.source / 'shaders').mkdir(parents=True)
        (self.source / 'lib.rs').write_bytes(
            'const S: &str = include_str!("shaders/test.wgsl");\r\n// 日本語の注記\r\n'.encode())
        (self.source / 'shaders/test.wgsl').write_bytes(b'@compute @workgroup_size(1) fn main() {}\r\n')
        (self.repo / 'rendering-sandbox/Cargo.toml').write_text('[workspace]\n', encoding='utf-8')
        self.git('init', '--quiet')
        self.git('add', '.')
        self.git('-c', 'user.name=Source Test', '-c', 'user.email=source@example.invalid',
                 'commit', '--quiet', '-m', 'fixture')
        self.bundle = self.root / 'stage'

    def git(self, *args):
        return subprocess.check_output(['git', *args], cwd=self.repo).decode().strip()

    def test_original_bytes_revision_and_embedded_sources(self):
        result = export_sources(self.repo, self.bundle, 'v05')
        self.assertEqual(result['revision'], self.git('rev-parse', 'HEAD'))
        self.assertFalse(result['dirty'])
        entry = next(x for x in result['files'] if x['path'] == 'src/lib.rs')
        self.assertEqual(entry['includes'], ['src/shaders/test.wgsl'])
        self.assertEqual((self.bundle / entry['resource']).read_bytes(), (self.source / 'lib.rs').read_bytes())
        self.assertIn('workspace/Cargo.toml', [x['path'] for x in result['files']])
        self.assertEqual(json.loads((self.bundle / 'source-manifest.json').read_text('utf-8')), result)

    def test_local_changes_and_allowlist(self):
        (self.source / 'local.rs').write_text('fn local() {}', encoding='utf-8')
        (self.source / 'private.bin').write_bytes(b'not source')
        (self.repo / '.gitignore').write_text('ignored.rs\n', encoding='utf-8')
        (self.source / 'ignored.rs').write_text('not public', encoding='utf-8')
        (self.repo / 'rendering-sandbox/v05/target').mkdir()
        (self.repo / 'rendering-sandbox/v05/target/generated.rs').write_text('ignored', encoding='utf-8')
        result = export_sources(self.repo, self.bundle, 'v05')
        self.assertTrue(result['dirty'])
        names = [x['path'] for x in result['files']]
        self.assertIn('src/local.rs', names)
        self.assertNotIn('src/private.bin', names)
        self.assertNotIn('src/ignored.rs', names)
        self.assertFalse(any('target/' in x for x in names))

    def test_shader_encoding_errors_name_the_file(self):
        shader = self.source / 'shaders/test.wgsl'
        for data, reason in [(b'\xef\xbb\xbfshader', 'BOM'), (b'\xff', 'UTF-8')]:
            with self.subTest(reason=reason):
                shader.write_bytes(data)
                with self.assertRaisesRegex(ValueError, f'test.wgsl.*{reason}'):
                    export_sources(self.repo, self.bundle, 'v05')

    def test_output_and_version_are_restricted(self):
        with self.assertRaises(ValueError):
            export_sources(self.repo, self.repo / '.work', 'v05')
        with self.assertRaises(ValueError):
            export_sources(self.repo, self.bundle, '../outside')


if __name__ == '__main__':
    unittest.main()
