"""Check build output: local assets/links, article visibility, and original links."""
import argparse
import json
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import unquote, urljoin, urlsplit


class Page(HTMLParser):
    def __init__(self, text):
        super().__init__()
        self.refs = []
        self.module_refs = []
        self.ids = set()
        self.math = 0
        self.feed(text)

    def handle_starttag(self, tag, attributes):
        attrs = dict(attributes)
        if attrs.get('id'):
            self.ids.add(attrs['id'])
        if tag == 'a' and attrs.get('name'):
            self.ids.add(attrs['name'])
        if tag == 'span' and attrs.get('class') == 'math-inline':
            self.math += 1
        if tag == 'script' and attrs.get('type') == 'module':
            self.module_refs.append(attrs.get('src', ''))
        fields = ['href'] if tag in ('a', 'link') else ['src', 'poster'] if tag in ('img', 'script', 'iframe', 'video', 'audio', 'source') else []
        for field in fields:
            if attrs.get(field):
                self.refs.append(attrs[field])


def validate(root, source):
    root = root.resolve()
    pages = {p: Page(p.read_text(encoding='utf-8')) for p in root.rglob('*.html')}
    errors = []
    for path, page in pages.items():
        if path.name == '404.html':
            continue
        origin = 'https://nagakagachi.github.io/' + path.relative_to(root).as_posix()
        for ref in page.module_refs:
            if ref and not urlsplit(ref).path.endswith('.js'):
                errors.append(f'{path.relative_to(root)}: module must reference JavaScript: {ref}')
        for ref in page.refs:
            url = urlsplit(urljoin(origin, ref))
            if url.scheme not in ('http', 'https') or url.netloc != 'nagakagachi.github.io':
                continue
            target = root / unquote(url.path).lstrip('/')
            if target.is_dir():
                target /= 'index.html'
            if not target.is_file():
                errors.append(f'{path.relative_to(root)}: missing {ref}')
            elif url.fragment and target in pages and unquote(url.fragment) not in pages[target].ids:
                errors.append(f'{path.relative_to(root)}: missing anchor {ref}')
    article_count = 0
    for index in source.glob('content/*/*/index.md'):
        text = index.read_text(encoding='utf-8-sig')
        header = text.split('\n---\n', 1)[0]
        fields = {}
        for line in header.splitlines()[1:]:
            key, separator, value = line.partition(': ')
            if separator:
                fields[key] = json.loads(value)
        target = root / fields['url'].strip('/') / 'index.html'
        if fields.get('draft'):
            if target.exists():
                errors.append(f'Draft was published: {index}')
        else:
            article_count += 1
            if target not in pages:
                errors.append(f'Article missing: {index}')
            elif fields.get('hatena_original_url') and fields['hatena_original_url'] not in pages[target].refs:
                errors.append(f'Original article link missing: {index}')
    for name in ('hatena_backup', 'tools', 'content', 'drafts'):
        if (root / name).exists():
            errors.append(f'Private source directory in output: {name}')
    if errors:
        raise SystemExit('\n'.join(errors))
    print(f'Validated {article_count} public articles, {len(pages)} HTML files; links, assets, anchors, draft exclusion and original links OK')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('output', type=Path)
    parser.add_argument('--source', type=Path, default=Path('site'))
    args = parser.parse_args()
    validate(args.output, args.source)
