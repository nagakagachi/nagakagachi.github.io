"""Create Hugo page bundles from the verified Hatena archive (no dependencies)."""
import argparse
import hashlib
import html
import json
import re
from datetime import datetime
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import parse_qs, urlsplit


class Tag(HTMLParser):
    def handle_starttag(self, tag, attrs):
        self.tag = tag
        self.attrs = dict(attrs)

    handle_startendtag = handle_starttag


def sha(data):
    return hashlib.sha256(data).hexdigest()


def write_markdown(path, text):
    path.write_bytes(b'\xef\xbb\xbf' + (text.replace('\r\n', '\n').replace('\n', '\r\n')).encode('utf-8'))


def markdown_blocks(body):
    # Only standalone blocks with no nested HTML are converted. Complex layouts
    # and their attributes remain literal HTML; this avoids destructive guesses.
    def heading(match):
        if '<' in match[2]:
            return match[0]
        return '\n\n' + '#' * int(match[1]) + ' ' + html.unescape(match[2]).strip() + '\n\n'

    # Keep headings with attributes (especially Hatena's case-sensitive IDs).
    body = re.sub(r'<h([1-6])>(.*?)</h\1>', heading, body, flags=re.S | re.I)
    # Indented HTML must not become Markdown code; leave pre contents alone.
    pieces = re.split(r'(?s)(<pre\b[^>]*>.*?</pre>)', body)
    for index in range(0, len(pieces), 2):
        pieces[index] = re.sub(r'(?m)^ {4,}(?=</?(?:blockquote|p|div|h[1-6]|ul|ol|li|figure|figcaption)\b)', '', pieces[index])
    body = ''.join(pieces)

    def code(match):
        parser = Tag()
        parser.feed(match[1])
        language = parser.attrs.get('data-lang', '')
        if not re.fullmatch(r'[\w+.-]*', language):
            language = ''
        text = html.unescape(match[2])
        # Leave nested code/span markup untouched rather than losing styling.
        if re.search(r'</?[a-zA-Z][^>]*>', match[2]):
            return match[0]
        longest = max((len(x) for x in re.findall(r'`+', text)), default=0)
        fence = '`' * max(3, longest + 1)
        return '\n\n' + fence + language + '\n' + text.rstrip('\r\n') + '\n' + fence + '\n\n'

    # Standalone pre blocks, outside paragraphs/containers, are safe fences.
    body = re.sub(r'(?m)^(<pre\b[^>]*>)(.*?)</pre>[ \t]*(?=\r?$)', code, body, flags=re.S | re.I)

    def paragraph(match):
        content = re.sub(r'<br\s*/?>', '\n', match[1], flags=re.I)
        if '<' in content:
            return match[0]
        text = html.unescape(content).strip()
        text = re.sub(r'([\\`~*_{}\[\]<>])', r'\\\1', text)
        # Avoid accidentally creating Markdown lists or headings from prose.
        text = re.sub(r'(?m)^(\s*)([#>+-]|\d+[.)])(?=\s)', r'\1\\\2', text)
        return '\n\n' + text.replace('\r\n', '\n').replace('\n', '  \n') + '\n\n'

    body = re.sub(r'<p>([^<]*(?:<br\s*/?>[^<]*)*)</p>', paragraph, body, flags=re.I)
    return body.strip() + '\n'


def migrate(archive, destination):
    inventory = json.loads((archive / 'inventory.json').read_text(encoding='utf-8'))
    results = json.loads((archive / 'download-results.json').read_text(encoding='utf-8'))['assets']
    source = archive / inventory['source']['filename']
    if sha(source.read_bytes()) != inventory['source']['sha256']:
        raise ValueError('Export changed since inventory was generated')
    planned = []
    for article in inventory['articles']:
        name = article['id'].replace('/', '-')
        if not re.fullmatch(r'[\w.-]+', name) or name in ('.', '..'):
            raise ValueError('Unsafe article basename: ' + name)
        status = article['metadata']['STATUS'][0]
        if status not in ('Publish', 'Draft'):
            raise ValueError('Unsupported publication state: ' + status)
        folder = destination / 'content' / ('drafts' if status == 'Draft' else 'posts') / name
        if folder.exists():
            raise FileExistsError(f'{folder} already exists; refusing to overwrite edited articles')
        planned.append((article, folder))
    report = {'schema_version': 1, 'source_sha256': inventory['source']['sha256'], 'articles': []}
    for article, folder in planned:
        folder.mkdir(parents=True)
        record = {'id': article['id'], 'path': folder.relative_to(destination).as_posix() + '/index.md', 'draft': article['metadata']['STATUS'][0] == 'Draft', 'images': {}, 'formulas': [], 'remaining_sections': []}

        def local_image(url):
            normalized = 'https:' + url if url.startswith('//') else url
            entry = results.get(sha(normalized.encode('utf-8')))
            if not entry or entry['status'] != 'saved':
                return url
            filename = Path(entry['path']).name
            origin = archive / entry['path']
            data = origin.read_bytes()
            if sha(data) != entry['sha256']:
                raise ValueError('Archived image hash mismatch: ' + str(origin))
            image_dir = folder / 'images'
            image_dir.mkdir(exist_ok=True)
            target = image_dir / filename
            if not target.exists():
                target.write_bytes(data)
            record['images'][normalized] = {'path': 'images/' + filename, 'sha256': entry['sha256'], 'archive_path': entry['path']}
            return 'images/' + filename

        def rewrite_tag(match):
            parser = Tag()
            parser.feed(match[0])
            attrs = parser.attrs
            if parser.tag == 'img':
                url = attrs.get('src', '')
                normalized = 'https:' + url if url.startswith('//') else url
                if (urlsplit(normalized).hostname or '') in ('chart.apis.google.com', 'chart.googleapis.com'):
                    tex = parse_qs(urlsplit(normalized).query).get('chl', [''])[0]
                    if not tex.strip():
                        raise ValueError('Formula lacks TeX: ' + url)
                    record['formulas'].append({'url': normalized, 'tex': tex, 'alt': attrs.get('alt', '')})
                    # MathJax-compatible delimiters also work inside retained HTML.
                    return '<span class="math-inline">\\(' + html.escape(tex.strip(), quote=False) + '\\)</span>'
            fields = ['src', 'poster'] if parser.tag != 'a' else ['href']
            original = match[0]
            for field in fields:
                if field not in attrs:
                    continue
                new = local_image(attrs[field])
                if new != attrs[field]:
                    pattern = r'(\b' + field + r'\s*=\s*)([\x22\x27])(.*?)\2'
                    original = re.sub(pattern, lambda m: m[1] + m[2] + html.escape(new, quote=True) + m[2], original, flags=re.S | re.I)
            return original

        body_sections = [s[5:].lstrip('\r\n') for s in article['sections'] if s.startswith('BODY:')]
        if len(body_sections) != 1:
            raise ValueError('Expected exactly one BODY section: ' + article['id'])
        body = re.sub(r'<(?:img|a|source|video)\b[^>]*>', rewrite_tag, body_sections[0], flags=re.I | re.S)
        metadata = article['metadata']
        header = {
            'title': metadata['TITLE'][0],
            'date': datetime.strptime(metadata['DATE'][0], '%m/%d/%Y %H:%M:%S').isoformat() + '+09:00',
            'draft': record['draft'],
            'url': '/entry/' + article['id'] + '/',
            'categories': metadata.get('CATEGORY', []),
            'hatena_author': metadata.get('AUTHOR', [''])[0],
            'hatena_original_url': 'https://nagakagachi.hatenablog.com/entry/' + article['id'],
            'hatena_basename': article['id'],
            'math': bool(record['formulas']),
        }
        if metadata.get('IMAGE'):
            image_url = metadata['IMAGE'][0]
            if (urlsplit(image_url).hostname or '') in ('chart.apis.google.com', 'chart.googleapis.com'):
                # A formula thumbnail returned 404; preserve its source but do
                # not advertise a broken remote image as the new site's cover.
                header['hatena_original_image'] = image_url
            else:
                header['image'] = local_image(image_url)
        for section in article['sections']:
            if section.strip() and not section.startswith('BODY:'):
                record['remaining_sections'].append(section)
        # JSON values are valid YAML scalars/arrays. No YAML library required.
        frontmatter = '\n'.join(key + ': ' + json.dumps(value, ensure_ascii=False) for key, value in header.items())
        text = '---\n' + frontmatter + '\n---\n\n' + markdown_blocks(body)
        text += '\n---\n\n[元のはてなブログ記事](' + header['hatena_original_url'] + ')\n'
        write_markdown(folder / 'index.md', text)
        record['article_sha256'] = sha((folder / 'index.md').read_bytes())
        report['articles'].append(record)
    (archive / 'migration-results.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({'articles': len(planned), 'drafts': sum(a['draft'] for a in report['articles']), 'image_copies': sum(len(a['images']) for a in report['articles']), 'formula_occurrences': sum(len(a['formulas']) for a in report['articles'])}))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--archive', type=Path, default=Path('hatena_backup'))
    parser.add_argument('--site', type=Path, default=Path('site'))
    args = parser.parse_args()
    migrate(args.archive.resolve(), args.site.resolve())
