"""JSON-line local worker, shipped with its own Python runtime and offline models."""
import os
os.environ['QT_QPA_PLATFORM'] = 'offscreen'
import sys
import json
import uuid
import tempfile
import traceback
import hashlib
from urllib.parse import urlparse
from pathlib import Path

from PySide6.QtGui import QGuiApplication, QFontDatabase
from engine import Engine, ROOT, DATA, LANGUAGES, missing_models, find_model, extract_model, save_document


def serve():
    sys.stdin.reconfigure(encoding='utf-8')
    sys.stdout.reconfigure(encoding='utf-8', line_buffering=True)
    app = QGuiApplication([])
    font_dir = Path(os.environ.get('WINDIR', 'C:/Windows')) / 'Fonts'
    for name in ['msyh.ttc', 'msyhbd.ttc', 'segoeui.ttf', 'seguisym.ttf', 'Nirmala.ttc', 'YuGothR.ttc', 'malgun.ttf', 'tahoma.ttf']:
        if (font_dir / name).exists(): QFontDatabase.addApplicationFont(str(font_dir / name))
    engine = Engine()
    documents = {}
    index = json.loads((ROOT / 'assets/language-index.json').read_text(encoding='utf-8'))
    names = dict(LANGUAGES)

    def send(value):
        sys.stdout.write(json.dumps(value, ensure_ascii=False) + '\n')
        sys.stdout.flush()

    def install(source, target, progress):
        if find_model(source, target): return
        import requests
        entries = [entry for entry in index if entry['from_code'] == source and entry['to_code'] == target]
        if not entries: raise ValueError(f'暂时没有 {source} → {target} 的语言包')
        url = entries[-1]['links'][0]
        if not url.startswith('https://'): raise ValueError('语言包必须从 HTTPS 地址下载')
        DATA.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(prefix='download-', dir=DATA) as folder:
            archive = Path(folder) / 'language.argosmodel'
            response = None
            for attempt in range(6):
                if urlparse(url).scheme != 'https':
                    raise ValueError('语言包及其重定向必须使用 HTTPS')
                parsed = urlparse(url)
                if parsed.username or parsed.password or parsed.hostname != urlparse(entries[-1]['links'][0]).hostname:
                    raise ValueError('语言包重定向到未授权来源')
                response = requests.get(url, stream=True, timeout=(15, 35), allow_redirects=False)
                if response.status_code in (301, 302, 303, 307, 308):
                    from urllib.parse import urljoin
                    next_url = urljoin(url, response.headers.get('Location', ''))
                    response.close()
                    url = next_url
                    continue
                break
            else:
                raise ValueError('语言包重定向次数过多')
            with response:
                response.raise_for_status()
                written = 0
                with archive.open('wb') as output:
                    for chunk in response.iter_content(512 * 1024):
                        written += len(chunk)
                        if written > 1_500_000_000: raise ValueError('语言包大小超出限制')
                        output.write(chunk)
                        progress(f'正在下载 {source} → {target} · {written / 1048576:.1f} MB')
            expected_hash = entries[-1].get('sha256')
            if expected_hash:
                with archive.open('rb') as downloaded:
                    digest = hashlib.file_digest(downloaded, 'sha256').hexdigest()
                if digest != expected_hash:
                    raise ValueError('语言包 SHA256 校验失败')
            else:
                print(f'语言包 {source} → {target} 无发布摘要，已使用 HTTPS 同源下载及结构校验', file=sys.stderr)
            progress(f'正在安装 {source} → {target}')
            extract_model(archive, DATA / 'models', (source, target))

    for line in sys.stdin:
        request = None
        try:
            request = json.loads(line)
            request_id = request['id']
            params = request.get('params', {})
            method = request['method']
            progress = lambda text: send({'id': request_id, 'event': 'progress', 'text': text})
            if method == 'models':
                targets = {entry['to_code']: entry['to_name'] for entry in index if entry['from_code'] == 'en'}
                targets['en'] = 'English'
                languages = [{'code': code, 'name': names.get(code, name), 'installed': not missing_models('auto', code)} for code, name in targets.items()]
                languages.sort(key=lambda item: (item['code'] not in ['en', 'zh'], item['code'] != 'en', item['name']))
                result = {'bilingualReady': not missing_models('auto', 'en') and not missing_models('auto', 'zh'), 'languages': languages}
            elif method == 'install':
                target = str(params['target'])
                for source, destination in missing_models('auto', target): install(source, destination, progress)
                result = {'installed': True, 'target': target}
            elif method == 'translate':
                source, target = params['source'], params['target']
                for src, dst in missing_models(source, target):
                    if params.get('offline', True): raise ValueError('缺少目标语言包，请先打开「离线语言包」安装，或关闭离线模式允许自动下载。')
                    install(src, dst, progress)
                document = engine.analyze(params['input'], source, target, progress)
                output = Path(params['directory']) / 'translated.png'
                save_document(document, output)
                doc_id = uuid.uuid4().hex
                documents[doc_id] = document
                result = {'docId': doc_id, 'path': str(output), 'blocks': document.serializable()['blocks'], 'warnings': document.warnings or []}
            elif method == 'render':
                document = documents[params['docId']]
                edits = params['edits']
                if len(edits) != len(document.blocks): raise ValueError('文字块数量不匹配，请重新识别图片')
                for block, edit in zip(document.blocks, edits):
                    block.translated = str(edit['translated'])[:10000]
                    block.enabled = bool(edit.get('enabled', True))
                save_document(document, document.output)
                result = {'docId': params['docId'], 'path': document.output, 'blocks': document.serializable()['blocks'], 'warnings': document.warnings or []}
            elif method == 'release':
                for doc_id in params.get('docIds', []): documents.pop(doc_id, None)
                result = {'released': True}
            else:
                raise ValueError('未知的本地处理请求')
            send({'id': request_id, 'result': result})
        except Exception as error:
            traceback.print_exc(file=sys.stderr)
            send({'id': request.get('id') if isinstance(request, dict) else None, 'error': str(error)})
    return 0


if __name__ == '__main__':
    sys.exit(serve())

