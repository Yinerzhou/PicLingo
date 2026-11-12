"""Local OCR, Argos/CTranslate2 translation, and editable image composition."""
from __future__ import annotations

import json
import math
import os
import re
import sys
import threading
import zipfile
from dataclasses import dataclass, asdict
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageOps
from PySide6.QtCore import QRectF, Qt
from PySide6.QtGui import QColor, QFont, QImage, QPainter, QTextDocument, QTextOption

VERSION = "1.0.0"
ROOT = Path(getattr(sys, "_MEIPASS", Path(__file__).resolve().parent.parent))
DATA = Path(os.environ.get("LOCALAPPDATA", str(Path.home()))) / "PicLingo"
LANGUAGES = [
    ("en", "英语 English"), ("zh", "简体中文"), ("zt", "繁體中文"),
    ("ja", "日语 日本語"), ("ko", "韩语 한국어"), ("fr", "法语 Français"),
    ("de", "德语 Deutsch"), ("es", "西班牙语 Español"), ("pt", "葡萄牙语"),
    ("it", "意大利语 Italiano"), ("ru", "俄语 Русский"), ("ar", "阿拉伯语 العربية"),
    ("th", "泰语 ไทย"), ("vi", "越南语 Tiếng Việt"), ("id", "印尼语"),
    ("hi", "印地语 हिन्दी"), ("tr", "土耳其语"), ("nl", "荷兰语"),
    ("pl", "波兰语"), ("uk", "乌克兰语"), ("cs", "捷克语"),
    ("da", "丹麦语"), ("fi", "芬兰语"), ("sv", "瑞典语"),
    ("nb", "挪威语"), ("el", "希腊语"), ("he", "希伯来语"),
    ("fa", "波斯语"), ("ur", "乌尔都语"), ("bn", "孟加拉语"),
    ("hu", "匈牙利语"), ("ro", "罗马尼亚语"), ("bg", "保加利亚语"),
    ("sk", "斯洛伐克语"), ("sl", "斯洛文尼亚语"), ("lt", "立陶宛语"),
    ("lv", "拉脱维亚语"), ("et", "爱沙尼亚语"), ("ca", "加泰罗尼亚语"),
    ("eo", "世界语"), ("az", "阿塞拜疆语"), ("eu", "巴斯克语"),
    ("ga", "爱尔兰语"), ("gl", "加利西亚语"), ("ms", "马来语"),
    ("sq", "阿尔巴尼亚语"), ("tl", "菲律宾语"), ("sw", "斯瓦希里语"),
]
IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp", ".bmp", ".tif", ".tiff"}


class Cancelled(Exception):
    pass


def safe_image(path: str | Path) -> np.ndarray:
    with Image.open(path) as im:
        if im.width * im.height > 50_000_000:
            raise ValueError("图片超过 5000 万像素，请先缩小后导入。")
        im = ImageOps.exif_transpose(im).convert("RGBA")
        return np.array(im)


def is_chinese(text: str) -> bool:
    return bool(re.search(r"[\u3400-\u9fff]", text))


def model_roots():
    return [DATA / "models", ROOT / "models"]


def find_model(source: str, target: str) -> Path | None:
    for root in model_roots():
        if not root.exists():
            continue
        for meta in root.glob("*/metadata.json"):
            try:
                data = json.loads(meta.read_text(encoding="utf-8"))
                if data["from_code"] == source and data["to_code"] == target:
                    folder = meta.parent
                    if (folder / "model/model.bin").is_file() and (folder / "sentencepiece.model").is_file():
                        return folder
            except (OSError, ValueError, KeyError):
                continue
    return None


def route(source: str, target: str):
    if source == target:
        return []
    if find_model(source, target):
        return [(source, target)]
    if source == "en" or target == "en":
        return [(source, target)]
    return [(source, "en"), ("en", target)]


def missing_models(source: str, target: str):
    sources = ("zh", "en") if source == "auto" else (source,)
    return sorted({pair for src in sources for pair in route(src, target) if not find_model(*pair)})


def extract_model(archive: Path, dest: Path, expected=None) -> Path:
    """Validate the archive before extracting; never extract traversal members."""
    with zipfile.ZipFile(archive) as z:
        if sum(i.file_size for i in z.infolist()) > 2_000_000_000:
            raise ValueError("语言包解压大小异常。")
        for entry in z.namelist():
            p = Path(entry.replace("\\", "/"))
            if p.is_absolute() or ".." in p.parts or ":" in entry:
                raise ValueError("语言包含有不安全的路径。")
        metas = [n for n in z.namelist() if n.endswith("/metadata.json")]
        if len(metas) != 1:
            raise ValueError("语言包缺少唯一的 metadata.json。")
        meta = json.loads(z.read(metas[0]))
        pair = (meta.get("from_code"), meta.get("to_code"))
        if expected and pair != tuple(expected):
            raise ValueError("下载的语言包与目标语言不符。")
        prefix = metas[0].rsplit("/", 1)[0]
        required = [f"{prefix}/model/model.bin", f"{prefix}/model/config.json", f"{prefix}/sentencepiece.model"]
        if not all(n in z.namelist() for n in required):
            raise ValueError("语言包不完整。")
        target = dest / (pair[0] + "_" + pair[1])
        if target.exists():
            raise ValueError("此语言包已经安装。")
        import shutil
        import tempfile
        dest.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(prefix=".download-", dir=dest) as temporary:
            stage = Path(temporary) / "ready"
            stage.mkdir()
            for item in z.infolist():
                rel = item.filename[len(prefix) + 1:] if item.filename.startswith(prefix + "/") else ""
                if not rel or item.is_dir() or rel.startswith("stanza/"):
                    continue
                output = stage / rel
                output.parent.mkdir(parents=True, exist_ok=True)
                with z.open(item) as src, output.open("wb") as dst:
                    shutil.copyfileobj(src, dst)
            stage.rename(target)
        return target


class LocalTranslator:
    def __init__(self):
        self.models = {}
        self.cache = {}

    def _get(self, source, target):
        pair = (source, target)
        if pair not in self.models:
            path = find_model(*pair)
            if not path:
                raise RuntimeError(f"缺少 {source} → {target} 离线语言包，请打开「语言包」下载。")
            import ctranslate2
            import sentencepiece as spm
            tokenizer = spm.SentencePieceProcessor(model_file=str(path / "sentencepiece.model"))
            translator = ctranslate2.Translator(str(path / "model"), device="cpu", compute_type="int8", inter_threads=1, intra_threads=max(1, min(4, os.cpu_count() or 2)))
            self.models[pair] = tokenizer, translator
        return self.models[pair]

    def translate(self, text, source, target):
        if not text.strip():
            return text
        if source == "auto":
            source = "zh" if is_chinese(text) else "en"
        if source == target or not any(c.isalpha() for c in text):
            return text
        key = (text, source, target)
        if key in self.cache:
            return self.cache[key]
        translated = text
        for src, dst in route(source, target):
            tokenizer, translator = self._get(src, dst)
            # Split long OCR strings at sentence boundaries; cap token chunks below model limits.
            pieces = [x for x in re.split(r"(?<=[。！？!?;；])\s*|\n+", translated) if x.strip()]
            tokens = []
            for piece in pieces:
                encoded = tokenizer.encode(piece, out_type=str)
                tokens.extend(encoded[i:i + 200] for i in range(0, len(encoded), 200))
            result = translator.translate_batch(tokens, beam_size=4, max_decoding_length=256, repetition_penalty=1.1)
            # Argos models use a joint output vocabulary wider than the source
            # SentencePiece vocabulary. Decode pieces directly as Argos does;
            # SentencePiece.decode would leave unknown target pieces unjoined.
            translated = " ".join("".join(item.hypotheses[0]).replace("▁", " ").strip() for item in result)
        self.cache[key] = translated
        return translated


@dataclass
class Block:
    polygon: list
    source: str
    translated: str
    confidence: float
    color: list
    enabled: bool = True


@dataclass
class Document:
    path: str
    blocks: list[Block]
    target: str
    output: str = ""
    warnings: list | None = None

    def serializable(self):
        return {"version": VERSION, "path": self.path, "target": self.target, "blocks": [asdict(b) for b in self.blocks], "warnings": self.warnings or []}


def estimate_color(image, points):
    x, y, w, h = cv2.boundingRect(points.astype(np.int32))
    crop = image[max(0, y):max(0, y) + h, max(0, x):max(0, x) + w, :3]
    if not crop.size:
        return [24, 31, 48]
    gray = cv2.cvtColor(crop, cv2.COLOR_RGB2GRAY)
    threshold, _ = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    border = np.concatenate((crop[0], crop[-1], crop[:, 0], crop[:, -1]))
    bg = float(np.median(cv2.cvtColor(border.reshape(1, -1, 3), cv2.COLOR_RGB2GRAY)))
    foreground = crop[gray < threshold] if bg > threshold else crop[gray > threshold]
    if len(foreground) < 2:
        return [24, 31, 48] if bg > 128 else [250, 250, 250]
    return np.median(foreground, axis=0).astype(int).tolist()


class Engine:
    def __init__(self):
        self.ocr = None
        self.translator = LocalTranslator()

    def analyze(self, path, source, target, progress=lambda _: None, cancelled=lambda: False):
        image = safe_image(path)
        progress("识别文字")
        if self.ocr is None:
            from rapidocr_onnxruntime import RapidOCR
            self.ocr = RapidOCR(intra_op_num_threads=2, inter_op_num_threads=1)
        alpha = image[:, :, 3:4].astype(np.float32) / 255
        ocr_rgb = (image[:, :, :3] * alpha + 255 * (1 - alpha)).astype(np.uint8)
        result, _ = self.ocr(cv2.cvtColor(ocr_rgb, cv2.COLOR_RGB2BGR))
        blocks = []
        for idx, (polygon, text, score) in enumerate(result or []):
            if cancelled():
                raise Cancelled()
            if score < 0.40:
                continue
            progress(f"翻译 {idx + 1}/{len(result)}")
            translated = self.translator.translate(text, source, target)
            blocks.append(Block(np.asarray(polygon).tolist(), text, translated, float(score), estimate_color(image, np.array(polygon))))
        return Document(str(path), blocks, target)


def _layout(text, width, size, color, rtl=False):
    doc = QTextDocument()
    doc.setDocumentMargin(0)
    font = QFont("Microsoft YaHei")
    font.setPixelSize(max(4, int(size)))
    doc.setDefaultFont(font)
    option = QTextOption()
    option.setWrapMode(QTextOption.WrapMode.WrapAtWordBoundaryOrAnywhere)
    option.setAlignment(Qt.AlignmentFlag.AlignCenter)
    if rtl:
        option.setTextDirection(Qt.LayoutDirection.RightToLeft)
    doc.setDefaultTextOption(option)
    doc.setPlainText(text)
    doc.setTextWidth(width)
    from PySide6.QtGui import QTextCharFormat, QTextCursor
    cursor = QTextCursor(doc)
    cursor.select(QTextCursor.SelectionType.Document)
    fmt = QTextCharFormat()
    fmt.setForeground(QColor(*color))
    cursor.mergeCharFormat(fmt)
    return doc


def render(document: Document, repair="智能修复", font_scale=1.0):
    original = safe_image(document.path)
    rgb = original[:, :, :3].copy()
    alpha = original[:, :, 3].copy()
    mask = np.zeros(rgb.shape[:2], np.uint8)
    active = [b for b in document.blocks if b.enabled and b.translated != b.source and b.translated.strip()]
    for block in active:
        polygon = np.array(block.polygon, np.int32)
        local = np.zeros_like(mask)
        cv2.fillPoly(local, [polygon], 255)
        if repair == "纯色覆盖":
            # Background sampled from a narrow ring immediately outside the OCR polygon.
            expanded = cv2.dilate(local, np.ones((7, 7), np.uint8))
            border = (expanded > 0) & (local == 0)
            color = np.median(rgb[border], axis=0) if border.any() else [255, 255, 255]
            rgb[local > 0] = color
            if border.any():
                alpha[local > 0] = np.median(alpha[border])
        else:
            # Inpaint only foreground-like pixels, to preserve textures between letters.
            gray = cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY)
            region = gray[local > 0]
            if not region.size:
                continue
            threshold, _ = cv2.threshold(region.reshape(-1, 1), 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
            fg_luma = float(np.dot(block.color, [0.299, 0.587, 0.114]))
            ink = (gray <= threshold) if fg_luma <= threshold else (gray >= threshold)
            part = np.where(ink & (local > 0), 255, 0).astype(np.uint8)
            part = cv2.dilate(part, np.ones((3, 3), np.uint8))
            mask = cv2.bitwise_or(mask, cv2.bitwise_and(part, cv2.dilate(local, np.ones((3, 3), np.uint8))))
    if mask.any():
        rgb = cv2.inpaint(rgb, mask, 3, cv2.INPAINT_TELEA)
        alpha = cv2.inpaint(alpha, mask, 3, cv2.INPAINT_TELEA)
    rgba = np.dstack([rgb, alpha])
    h, w = rgba.shape[:2]
    image = QImage(rgba.data, w, h, rgba.strides[0], QImage.Format.Format_RGBA8888).copy()
    painter = QPainter(image)
    painter.setRenderHint(QPainter.RenderHint.TextAntialiasing)
    warnings = []
    for i, block in enumerate(active):
        points = np.array(block.polygon, float)
        tl, tr, br, bl = points
        bw = max(8.0, float((np.linalg.norm(tr - tl) + np.linalg.norm(br - bl)) / 2))
        bh = max(8.0, float((np.linalg.norm(bl - tl) + np.linalg.norm(br - tr)) / 2))
        angle = math.degrees(math.atan2(tr[1] - tl[1], tr[0] - tl[0]))
        size = min(120, max(6, int(bh * 0.78 * font_scale)))
        doc = _layout(block.translated, bw, size, block.color, document.target in ("ar", "he", "fa", "ur"))
        while doc.size().height() > bh and size > 5:
            size -= 1
            doc = _layout(block.translated, bw, size, block.color, document.target in ("ar", "he", "fa", "ur"))
        if size < 9 or doc.size().height() > bh:
            warnings.append(f"第 {i + 1} 处译文较长，建议人工缩短。")
        painter.save()
        painter.translate(float(tl[0]), float(tl[1]))
        painter.rotate(angle)
        painter.setClipRect(QRectF(0, 0, bw, bh))
        painter.translate(0, max(0, (bh - doc.size().height()) / 2))
        doc.drawContents(painter, QRectF(0, 0, bw, bh))
        painter.restore()
    painter.end()
    document.warnings = warnings
    return image


def unique_output(directory, stem, target):
    directory = Path(directory)
    directory.mkdir(parents=True, exist_ok=True)
    base = directory / f"{stem}_{target}.png"
    candidate = base
    index = 2
    while candidate.exists() or candidate.with_suffix(".json").exists():
        candidate = directory / f"{base.stem}_{index}.png"
        index += 1
    return candidate


def save_document(document, output, repair="智能修复", font_scale=1.0):
    image = render(document, repair, font_scale)
    output = Path(output)
    if not image.save(str(output), "PNG"):
        raise OSError("保存图片失败，请检查输出文件夹权限或剩余空间。")
    document.output = str(output)
    output.with_suffix(".json").write_text(json.dumps(document.serializable(), ensure_ascii=False, indent=2), encoding="utf-8")
    return image
