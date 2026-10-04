"""Inventory and preserve Hatena MT exports without rewriting the source."""
import argparse
import hashlib
import json
import re
import time
from datetime import datetime, timezone
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import parse_qs, urlsplit
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError


def digest(data):
    return hashlib.sha256(data).hexdigest()


def save_json(path, data):
    temporary = path.with_suffix(path.suffix + '.tmp')
    temporary.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    # Windows scanners/readers can hold a brief lock on the destination.
    for attempt in range(10):
        try:
            temporary.replace(path)
            break
        except PermissionError:
            if attempt == 9:
                raise
            time.sleep(0.2)


class References(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.items = []

    def handle_starttag(self, tag, attributes):
        attrs = dict(attributes)
        fields = []
        if tag in ('img', 'iframe', 'video', 'audio', 'source', 'embed', 'script'):
            fields.append('src')
        if tag == 'video':
            fields.append('poster')
        if tag == 'object':
            fields.append('data')
        if tag == 'a':
            fields.append('href')
        for field in fields:
            if attrs.get(field):
                self.items.append({'tag': tag, 'attribute': field, 'url': attrs[field], 'attributes': attrs})
        # Retain every candidate, including resolution/density descriptors.
        if tag in ('img', 'source') and attrs.get('srcset'):
            for candidate in attrs['srcset'].split(','):
                parts = candidate.strip().split()
                if parts:
                    self.items.append({'tag': tag, 'attribute': 'srcset', 'url': parts[0], 'attributes': attrs})

    handle_startendtag = handle_starttag


def classify(ref):
    parts = urlsplit(ref['url'])
    host = (parts.hostname or '').lower()
    if parts.scheme not in ('http', 'https'):
        return 'non_http'
    if host == 'chart.apis.google.com' or host == 'chart.googleapis.com':
        return 'formula'
    if host.endswith('.f.st-hatena.com') and '/images/fotolife/' in parts.path:
        return 'fotolife'
    if ref['tag'] == 'iframe':
        return 'embed'
    if ref['tag'] == 'script':
        return 'script'
    if ref['tag'] in ('img', 'video', 'audio', 'source', 'embed', 'object', 'IMAGE'):
        return 'media'
    if re.search(r'\.(png|jpe?g|gif|webp|svg|avif|mp4|webm|mp3|wav|pdf)$', parts.path, re.I):
        return 'linked_file'
    return 'link'


def inventory(source, output):
    raw = source.read_bytes()
    text = raw.decode('utf-8-sig')
    articles = []
    assets = {}
    for record in re.split(r'(?m)^--------\r?\n?', text):
        if not record.strip():
            continue
        sections = re.split(r'(?m)^-----\r?\n', record)
        metadata = {}
        for line in sections[0].splitlines():
            key, separator, value = line.partition(': ')
            if separator:
                metadata.setdefault(key, []).append(value)
        if 'TITLE' not in metadata or 'BASENAME' not in metadata:
            raise ValueError('Unrecognized MT record; inventory aborted')
        article_id = metadata['BASENAME'][0]
        references = []
        for number, section in enumerate(sections[1:]):
            parser = References()
            parser.feed(section)
            for ref in parser.items:
                ref['section'] = number
                references.append(ref)
        for url in metadata.get('IMAGE', []):
            references.append({'tag': 'IMAGE', 'attribute': 'url', 'url': url, 'attributes': {}, 'section': 'metadata'})
        for ref in references:
            if ref['url'].startswith('//'):
                ref['original_url'] = ref['url']
                ref['url'] = 'https:' + ref['url']
            ref['kind'] = classify(ref)
            url = ref['url']
            if ref['kind'] == 'formula':
                ref['tex'] = parse_qs(urlsplit(url).query).get('chl', [''])[0]
            if ref['kind'] in ('fotolife', 'formula', 'media', 'linked_file'):
                asset_id = digest(url.encode('utf-8'))
                ref['asset_id'] = asset_id
                extension = Path(urlsplit(url).path).suffix.lower()
                if not re.fullmatch(r'\.[a-z0-9]{1,5}', extension):
                    extension = '.bin'
                asset = assets.setdefault(asset_id, {'id': asset_id, 'url': url, 'kind': ref['kind'], 'path': 'media/' + asset_id + extension, 'articles': []})
                if article_id not in asset['articles']:
                    asset['articles'].append(article_id)
        articles.append({'id': article_id, 'metadata': metadata, 'sections': sections[1:], 'references': references})
    result = {'schema_version': 1, 'created_at': datetime.now(timezone.utc).isoformat(), 'source': {'filename': source.name, 'sha256': digest(raw), 'bytes': len(raw)}, 'articles': articles, 'assets': list(assets.values())}
    save_json(output / 'inventory.json', result)
    counts = {}
    for asset in assets.values():
        counts[asset['kind']] = counts.get(asset['kind'], 0) + 1
    print(json.dumps({'articles': len(articles), 'assets': len(assets), 'asset_kinds': counts}, ensure_ascii=False))
    return result


def image_type(data):
    if data.startswith(b'\x89PNG\r\n\x1a\n'):
        return 'png'
    if data.startswith(b'\xff\xd8\xff'):
        return 'jpg'
    if data.startswith((b'GIF87a', b'GIF89a')):
        return 'gif'
    if data[:4] == b'RIFF' and data[8:12] == b'WEBP':
        return 'webp'
    return None


def download(data, output, kinds, limit):
    results_path = output / 'download-results.json'
    results = json.loads(results_path.read_text(encoding='utf-8')) if results_path.exists() else {'schema_version': 1, 'assets': {}}
    selected = [asset for asset in data['assets'] if asset['kind'] in kinds]
    if limit:
        selected = selected[:limit]
    for index, asset in enumerate(selected, 1):
        previous = results['assets'].get(asset['id'], {})
        path = output / previous.get('path', asset['path'])
        if previous.get('status') == 'saved' and path.exists() and digest(path.read_bytes()) == previous.get('sha256'):
            continue
        entry = {'url': asset['url'], 'attempted_at': datetime.now(timezone.utc).isoformat()}
        try:
            request = Request(asset['url'], headers={'User-Agent': 'HatenaPersonalArchive/1.0'})
            with urlopen(request, timeout=20) as response:
                content = response.read(64 * 1024 * 1024 + 1)
                if len(content) > 64 * 1024 * 1024:
                    raise ValueError('Asset exceeds 64 MiB; manual download required')
                if not content:
                    raise ValueError('Empty response')
                content_type = response.headers.get('Content-Type', '')
                detected = image_type(content)
                if asset['kind'] in ('fotolife', 'formula') and not detected:
                    raise ValueError('Response is not a recognized raster image: ' + content_type)
                relative = asset['path']
                if detected:
                    relative = str(Path(relative).with_suffix('.' + detected)).replace('\\', '/')
                path = output / relative
                path.parent.mkdir(parents=True, exist_ok=True)
                temporary = path.with_suffix(path.suffix + '.part')
                temporary.write_bytes(content)
                temporary.replace(path)
                entry.update(status='saved', path=relative, bytes=len(content), sha256=digest(content), content_type=content_type, final_url=response.url, http_status=response.status)
        except (HTTPError, URLError, TimeoutError, OSError, ValueError) as error:
            entry.update(status='failed', error=str(error))
        results['assets'][asset['id']] = entry
        save_json(results_path, results)
        print(f"{index}/{len(selected)} {entry['status']} {asset['id'][:12]}", flush=True)
        time.sleep(0.25)
    counts = {}
    for entry in results['assets'].values():
        counts[entry['status']] = counts.get(entry['status'], 0) + 1
    print(json.dumps(counts))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source', type=Path)
    parser.add_argument('--download', action='store_true')
    parser.add_argument('--kinds', nargs='+', default=['fotolife', 'formula'])
    parser.add_argument('--limit', type=int, default=0)
    args = parser.parse_args()
    output = args.source.resolve().parent
    data = inventory(args.source, output)
    if args.download:
        download(data, output, args.kinds, args.limit)


if __name__ == '__main__':
    main()
