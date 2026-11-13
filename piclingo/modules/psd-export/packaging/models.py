"""构建时准备中英离线模型，下载及解压均核对固定 SHA256。"""
import hashlib
import json
import shutil
import tempfile
import urllib.request
import zipfile
from pathlib import Path, PurePosixPath


def sha256(path):
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def ensure_models(workspace):
    workspace = Path(workspace).resolve()
    manifest = json.loads((Path(__file__).parent / "model-manifest.json").read_text(encoding="utf-8"))
    models = workspace / "work/models"
    models.mkdir(parents=True, exist_ok=True)
    for item in manifest:
        destination = models / item["directory"]
        if destination.exists():
            if sha256(destination / "model/model.bin") != item["model_sha256"]:
                raise RuntimeError("已有模型校验失败：" + str(destination))
            continue
        with tempfile.TemporaryDirectory(prefix="build-model-", dir=models) as temporary:
            temporary = Path(temporary)
            archive = temporary / "language.argosmodel"
            request = urllib.request.Request(item["url"], headers={"User-Agent": "PicLingo-Build/1.2"})
            with urllib.request.urlopen(request, timeout=120) as response, archive.open("wb") as output:
                if not response.geturl().startswith("https://"):
                    raise RuntimeError("模型下载地址必须保持 HTTPS")
                size = 0
                while True:
                    block = response.read(1024 * 1024)
                    if not block:
                        break
                    size += len(block)
                    if size > 500_000_000:
                        raise RuntimeError("模型压缩包大小超出限制")
                    output.write(block)
            if sha256(archive) != item["archive_sha256"]:
                raise RuntimeError("模型压缩包 SHA256 不匹配：" + item["url"])
            extraction = temporary / "extracted"
            extraction.mkdir()
            with zipfile.ZipFile(archive) as source:
                total = 0
                for entry in source.infolist():
                    parts = PurePosixPath(entry.filename)
                    if parts.is_absolute() or ".." in parts.parts or "\\" in entry.filename or (entry.external_attr >> 16) & 0o170000 == 0o120000:
                        raise RuntimeError("模型包含非法路径")
                    path = (extraction / Path(*parts.parts)).resolve()
                    if not path.is_relative_to(extraction):
                        raise RuntimeError("模型解压路径越界")
                    total += entry.file_size
                    if total > 1_500_000_000:
                        raise RuntimeError("模型展开大小超出限制")
                    if entry.is_dir():
                        path.mkdir(parents=True, exist_ok=True)
                    else:
                        path.parent.mkdir(parents=True, exist_ok=True)
                        with source.open(entry) as input_stream, path.open("xb") as output_stream:
                            shutil.copyfileobj(input_stream, output_stream)
            candidates = list(extraction.rglob("metadata.json"))
            matching = []
            for metadata in candidates:
                details = json.loads(metadata.read_text(encoding="utf-8"))
                if details.get("from_code") == item["source"] and details.get("to_code") == item["target"]:
                    matching.append(metadata.parent)
            if len(matching) != 1 or sha256(matching[0] / "model/model.bin") != item["model_sha256"]:
                raise RuntimeError("模型内容或语言元数据不符合预期")
            shutil.copytree(matching[0], destination)
