from pathlib import Path
from PyInstaller.utils.hooks import collect_all
root = Path(SPECPATH)
datas = [(str(root / 'assets'), 'assets'), (str(root / 'models/zh_en'), 'models/zh_en'), (str(root / 'models/en_zh'), 'models/en_zh')]
binaries, hiddenimports = [], []
for package in ['rapidocr_onnxruntime', 'onnxruntime', 'ctranslate2', 'sentencepiece', 'pyclipper', 'shapely']:
    ds, bs, hs = collect_all(package)
    datas += ds; binaries += bs; hiddenimports += hs
for name in ['vcruntime140.dll', 'vcruntime140_1.dll', 'msvcp140.dll', 'msvcp140_1.dll', 'msvcp140_2.dll']:
    p = Path('C:/Windows/System32') / name
    if p.exists(): binaries.append((str(p), '.'))
excludes = ['torch', 'tensorflow', 'transformers', 'scipy', 'pandas', 'matplotlib', 'IPython', 'pytest', 'tkinter', 'PySide6.QtWidgets', 'PySide6.QtWebEngineCore', 'PySide6.QtWebEngineWidgets', 'PySide6.QtPdf', 'PySide6.QtQml', 'PySide6.QtQuick', 'PySide6.QtMultimedia']
a = Analysis([str(root/'app/worker.py')], pathex=[str(root/'app')], binaries=binaries, datas=datas, hiddenimports=hiddenimports, excludes=excludes, noarchive=False)
pyz = PYZ(a.pure)
exe = EXE(pyz, a.scripts, [], exclude_binaries=True, name='PicLingoWorker', console=True, debug=False, strip=False, upx=False, icon=str(root/'assets/app.ico'))
coll = COLLECT(exe, a.binaries, a.datas, strip=False, upx=False, name='PicLingoWorker')
