# 独立 PSD 引擎，运行时通过 PICLINGO_PSD_HOME 写入用户数据目录。
from pathlib import Path
from PyInstaller.utils.hooks import collect_submodules

root = Path(SPECPATH).parent
datas = [(str(root / 'config.json'), '.'), (str(root / 'adapters'), 'adapters'), (str(root / 'photoshop'), 'photoshop')]
analysis = Analysis([str(root / 'service.py')], pathex=[str(root)], datas=datas,
                    hiddenimports=collect_submodules('fontTools.ttLib.tables'),
                    excludes=['tkinter', 'pytest', 'matplotlib', 'scipy', 'pandas', 'numpy'], noarchive=False)
archive = PYZ(analysis.pure)
executable = EXE(archive, analysis.scripts, [], exclude_binaries=True, name='PicLingoPSD',
                 console=True, debug=False, strip=False, upx=False)
collection = COLLECT(executable, analysis.binaries, analysis.datas, strip=False, upx=False, name='PicLingoPSD')
