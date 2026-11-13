"""【待 Mac 实机验证】按 PostScript 名检查字体字形，结果仅用于 PSD 模块。"""
import json
import os
import unicodedata
from pathlib import Path


class FontResolver:
    def __init__(self, state_root, extra_paths=()):
        self.state_root = Path(state_root)
        self.extra_paths = [Path(path).expanduser() for path in extra_paths]
        self.index = None
        self.coverage = {}

    def load_index(self):
        from fontTools.ttLib import TTFont, TTCollection

        folders = [Path(os.environ.get("WINDIR", "C:/Windows")) / "Fonts",
                   Path.home() / "AppData/Local/Microsoft/Windows/Fonts",
                   Path("/System/Library/Fonts"), Path("/Library/Fonts"), Path.home() / "Library/Fonts"]
        folders += self.extra_paths
        files = set()
        for folder in folders:
            if folder.is_file():
                files.add(folder)
            elif folder.is_dir():
                files.update(path for path in folder.rglob("*") if path.suffix.lower() in (".ttf", ".otf", ".ttc", ".otc"))
        fingerprint = {str(path): [path.stat().st_mtime_ns, path.stat().st_size] for path in files}
        cache = self.state_root / "font-index.json"
        try:
            saved = json.loads(cache.read_text(encoding="utf-8"))
            if saved["fingerprint"] == fingerprint:
                self.index = saved["index"]
                return
        except (OSError, ValueError, KeyError):
            pass
        index = {}
        for path in sorted(files):
            fonts = []
            collection = None
            try:
                if path.suffix.lower() in (".ttc", ".otc"):
                    collection = TTCollection(path, lazy=True)
                    fonts = collection.fonts
                else:
                    fonts = [TTFont(path, lazy=True)]
                for number, font in enumerate(fonts):
                    for name in font["name"].names:
                        if name.nameID == 6:
                            index.setdefault(name.toUnicode(), [str(path), number])
            except Exception:
                # 损坏或操作系统私有字体不可解析时，交由明确的 unknown 状态报告。
                continue
            finally:
                if collection:
                    collection.close()
                else:
                    for font in fonts:
                        font.close()
        self.state_root.mkdir(parents=True, exist_ok=True)
        cache.write_text(json.dumps({"fingerprint": fingerprint, "index": index}, ensure_ascii=False), encoding="utf-8")
        self.index = index

    def supports(self, name, text):
        from fontTools.ttLib import TTFont

        if self.index is None:
            self.load_index()
        if name not in self.index:
            return None
        if name not in self.coverage:
            path, number = self.index[name]
            try:
                with TTFont(path, fontNumber=number, lazy=True) as font:
                    self.coverage[name] = set((font.getBestCmap() or {}).keys())
            except Exception:
                return None
        needed = {ord(character) for character in text
                  if not character.isspace() and unicodedata.category(character) not in ("Cf", "Cc")}
        return needed <= self.coverage[name]

    def choose(self, names, text, fallbacks):
        checks = [self.supports(name, text) for name in names]
        if all(value is True for value in checks):
            return {"status": "covered", "font": None}
        for name in fallbacks:
            if self.supports(name, text) is True:
                return {"status": "fallback", "font": name, "original_checks": checks}
        return {"status": "missing_glyphs" if False in checks else "unknown_coverage", "font": None}
