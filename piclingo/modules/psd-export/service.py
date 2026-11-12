"""【待 Mac 实机验证】桌面与批处理入口，复用阶段 1 的 Photoshop 桥接。"""
import argparse
import copy
import json
import os
import re
import shutil
import sys
import time
import traceback
import uuid
import zipfile
import platform
from pathlib import Path

import cli
from excel_map import header_token, language_code, normalize_text, read_excel
from fonts import FontResolver


def emit(kind, **values):
    print(json.dumps({"event": kind, **values}, ensure_ascii=False), flush=True)


def configuration(settings, job):
    base = json.loads((cli.RESOURCE_ROOT / "config.json").read_text(encoding="utf-8-sig"))
    allowed = {"worksheet", "header_row", "match_by", "hidden_layers", "smart_objects", "duplicates",
               "empty_translation", "unmatched", "missing_font", "output", "overflow", "font_fallbacks",
               "rtl_enabled", "photoshop", "language_aliases", "language_names", "font_paths",
               "key_headers", "source_headers", "source_language", "text_normalization"}
    for key, value in settings.items():
        if key not in allowed:
            raise ValueError("未知配置项：" + key)
        if isinstance(base.get(key), dict) and isinstance(value, dict):
            base[key].update(value)
        else:
            base[key] = value
    path = job / "config.json"
    cli.json_write(path, base)
    return cli.load_config(path)


def workbook(path, config):
    from openpyxl import load_workbook

    path = Path(path).expanduser().resolve(strict=True)
    if path.suffix.lower() != ".xlsx":
        raise ValueError("请选择 XLSX 文件")
    original_hash = cli.file_hash(path)
    with path.open("rb") as stream:
        book = load_workbook(stream, read_only=True, data_only=False)
        try:
            sheets = book.sheetnames
            if config["worksheet"] is None and len(sheets) > 1:
                return {"sheets": sheets, "needs_sheet": True, "languages": [], "rows": [], "warnings": [], "sha256": original_hash}
            sheet = book[config["worksheet"] or sheets[0]]
            header = next(sheet.iter_rows(min_row=config["header_row"], max_row=config["header_row"], values_only=True), ())
            reserved = {header_token(value) for value in config["key_headers"] + config["source_headers"]}
            codes = []
            for value in header:
                if header_token(value) in reserved:
                    continue
                code = language_code(value, config)
                if code and code != config["source_language"] and code not in codes:
                    codes.append(code)
        finally:
            book.close()
    warnings = []
    rows = {}
    available = []
    # RTL 列可预览，实际导出时仍检查显式启用状态。
    preview_config = copy.deepcopy(config)
    preview_config["rtl_enabled"] = True
    for code in codes:
        def log(level, step, message, **details):
            if level == "warning":
                warnings.append({"step": step, "message": message, **details})
        _, entries = read_excel(path, code, preview_config, log)
        available.append({"code": code, "name": config["language_names"].get(code, code),
                          "rtl": code.split("-")[0] in ("ar", "he", "fa", "ur")})
        for entry in entries:
            row = rows.setdefault(entry["row"], {"row": entry["row"], "key": entry["key"], "source": entry["source"], "translations": {}})
            row["translations"][code] = entry["translation"]
    if not available:
        raise ValueError("未识别到目标语言列，请检查表头与语言映射")
    if cli.file_hash(path) != original_hash:
        raise RuntimeError("Excel 在读取期间发生变化，请重新导入")
    return {"sheets": sheets, "worksheet": config["worksheet"] or sheets[0], "needs_sheet": False,
            "languages": available, "rows": list(rows.values()), "warnings": warnings, "sha256": original_hash}


def photoshop(action, path, config, entries=(), output=None, target=None, expected_hash=None):
    run = cli.ROOT / "runs" / (time.strftime("%Y%m%d-%H%M%S") + "-" + uuid.uuid4().hex[:8])
    run.mkdir(parents=True)
    request = {"action": action, "input": str(path), "output": str(output) if output else None,
               "entries": list(entries), "target": target, "config": config,
               "event_file": str(run / "photoshop.jsonl"), "result_file": str(run / "result.json"),
               "started_file": str(run / "started.txt"),
               "deadline": int((time.time() + config["photoshop"]["task_timeout_seconds"] - 2) * 1000)}
    before = cli.file_hash(path)
    if expected_hash and before != expected_hash:
        raise RuntimeError("PSD 自确认匹配后发生变化，请重新读取匹配：" + str(path))
    log = cli.Journal(run / "run.jsonl")
    with cli.photoshop_lock():
        cli.invoke_bridge(config, cli.make_driver(request, run), run, log)
    result = json.loads((run / "result.json").read_text(encoding="utf-8-sig"))
    if cli.file_hash(path) != before:
        raise RuntimeError("原始 PSD 校验发生变化：" + str(path))
    if not result["ok"]:
        raise RuntimeError("%s：%s；日志 %s" % (result.get("failed_step"), result.get("error"), run))
    result["run_dir"] = str(run)
    result["source_unchanged"] = True
    result["source_sha256"] = before
    return result


def inspect_files(paths, config):
    results = []
    if not paths or len(paths) > 1000:
        raise ValueError("请选择 1～1000 个 PSD")
    for index, value in enumerate(dict.fromkeys(paths)):
        path = Path(value).expanduser().resolve()
        emit("progress", step="读取PSD", current=index + 1, total=len(paths), file=str(path))
        try:
            if path.suffix.lower() != ".psd" or not path.is_file():
                raise ValueError("PSD 不存在或扩展名不正确")
            result = photoshop("inspect", path, config)
            results.append({"path": str(path), "name": path.name, "ok": True, **result})
        except Exception as error:
            results.append({"path": str(path), "name": path.name, "ok": False, "error": str(error), "traceback": traceback.format_exc()})
    return results


def matches(documents, book, config, manual):
    rows = book["rows"]
    index = {}
    for row in rows:
        value = row["key"] if config["match_by"] == "key" else row["source"]
        if value is not None:
            index.setdefault(normalize_text(value, config), row)
    row_by_number = {row["row"]: row for row in rows}
    used = set()
    output = []
    for document in documents:
        if not document["ok"]:
            continue
        for layer in document["layers"]:
            if layer.get("type") == "smart_object":
                continue
            if config["match_by"] == "manual":
                row_number = manual.get(document["path"], {}).get(layer["route"])
                row = row_by_number.get(int(row_number)) if row_number else None
            else:
                value = layer["name"] if config["match_by"] == "key" else layer["original"]
                row = index.get(normalize_text(value, config))
            if row:
                used.add(row["row"])
            output.append({"file": document["path"], "route": layer["route"], "layer": layer,
                           "row": row, "status": "matched" if row else "unmatched"})
    return {"layers": output, "unused_rows": [row for row in rows if row["row"] not in used]}


def output_name(template, source, language):
    tokens = {"文件名": Path(source).stem, "语言": language,
              "filename": Path(source).stem, "language": language}
    unknown = set(re.findall(r"\{([^{}]+)\}", template)) - tokens.keys()
    if unknown or template.count("{") != template.count("}"):
        raise ValueError("命名规则仅支持 {文件名}、{语言}、{filename}、{language}")
    for key, value in tokens.items():
        template = template.replace("{" + key + "}", value)
    if "{" in template or "}" in template:
        raise ValueError("命名规则包含无效括号")
    name = re.sub(r'[<>:"/\\|?*\x00-\x1f]', "_", template).strip(" .")[:150]
    if not name:
        raise ValueError("命名规则生成了空文件名")
    if re.match(r"^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)", name, re.I):
        name = "_" + name
    return name


def publish(staging, folder, stem, extension):
    number = 1
    while True:
        destination = folder / (stem + ("" if number == 1 else "_" + str(number)) + "." + extension)
        try:
            stream = destination.open("xb")
        except FileExistsError:
            number += 1
            continue
        try:
            with stream, staging.open("rb") as source:
                shutil.copyfileobj(source, stream)
                stream.flush()
                os.fsync(stream.fileno())
        except BaseException:
            destination.unlink(missing_ok=True)
            raise
        return destination


def export_batch(request, config, job):
    folder = Path(request["output_dir"]).expanduser().resolve()
    folder.mkdir(parents=True, exist_ok=True)
    documents = inspect_files(request["files"], config)
    book = workbook(request["excel"], config)
    if request.get("excel_sha256") and book.get("sha256") != request["excel_sha256"]:
        raise RuntimeError("Excel 自确认匹配后发生变化，请重新导入并匹配")
    if book["needs_sheet"]:
        raise ValueError("请先选择 Excel 工作表")
    mapping = matches(documents, book, config, request.get("manual", {}))
    languages = list(dict.fromkeys(request["languages"]))
    available = {item["code"] for item in book["languages"]}
    if not languages or any(code not in available for code in languages):
        raise ValueError("请选择 Excel 中存在的输出语言")
    if any(code.split("-")[0] in ("ar", "he", "fa", "ur") for code in languages) and not config["rtl_enabled"]:
        raise ValueError("请先勾选 RTL 实验，并使用客户样张验收")
    # 先验证模板，避免完成渲染后才发现规则无效。
    template = request.get("naming", "{文件名}_{语言}")
    output_name(template, "test.psd", languages[0])
    resolver = FontResolver(cli.ROOT, config.get("font_paths", []))
    results = []
    total = len(documents) * len(languages)
    cancelled = False
    try:
        for document in documents:
            for language in languages:
                if (job / "cancel").exists():
                    cancelled = True
                    break
                emit("progress", step="导出", current=len(results), total=total, file=document["path"], language=language)
                started = time.monotonic()
                staging = folder / (".piclingo-" + uuid.uuid4().hex + "." + config["output"]["format"])
                try:
                    if not document["ok"]:
                        raise RuntimeError(document["error"])
                    expected = request.get("expected_hashes", {}).get(document["path"], document["source_sha256"])
                    if expected != document["source_sha256"]:
                        raise RuntimeError("PSD 自确认匹配后发生变化，请重新读取匹配")
                    entries = []
                    for match in mapping["layers"]:
                        if match["file"] != document["path"] or not match["row"]:
                            continue
                        layer = match["layer"]
                        row = match["row"]
                        translation = row["translations"].get(language)
                        decision = {"status": "covered", "font": None}
                        if translation:
                            fallback = config["font_fallbacks"].get(language, config["font_fallbacks"].get(language.split("-")[0], []))
                            fallback = [font for font in fallback if font in document.get("available_fonts", [])]
                            decision = resolver.choose(layer["fonts"]["names"], translation, fallback)
                        entries.append({"row": row["row"], "route": match["route"], "match": "", "translation": translation,
                                        "font_decision": decision})
                    ps_result = photoshop("translate", Path(document["path"]), config, entries, staging, language, expected_hash=expected)
                    if config["output"]["format"] == "png":
                        if list(cli.inspect_png(staging)) != ps_result["dimensions"]:
                            raise ValueError("导出尺寸不一致")
                        if config["output"]["color_profile"] == "sRGB IEC61966-2.1":
                            cli.tag_srgb(staging)
                    if not staging.is_file() or staging.stat().st_size == 0:
                        raise ValueError("Photoshop 输出为空")
                    destination = publish(staging, folder, output_name(template, document["path"], language), config["output"]["format"])
                    results.append({"file": document["path"], "language": language, "ok": True,
                                    "output": str(destination), "photoshop": ps_result,
                                    "elapsed_ms": round((time.monotonic() - started) * 1000)})
                except Exception as error:
                    results.append({"file": document["path"], "language": language, "ok": False,
                                    "error": str(error), "traceback": traceback.format_exc(),
                                    "elapsed_ms": round((time.monotonic() - started) * 1000)})
                finally:
                    if not (cli.ROOT / "runs/RECOVERY_REQUIRED.json").exists():
                        staging.unlink(missing_ok=True)
                emit("progress", step="进度", current=len(results), total=total, last=results[-1])
            if cancelled:
                break
    finally:
        report = {"results": results, "success_count": sum(item["ok"] for item in results),
                  "failure_count": sum(not item["ok"] for item in results), "cancelled": cancelled,
                  "planned": total, "output_dir": str(folder), "mapping": mapping,
                  "rtl_experimental": config["rtl_enabled"], "mac_verified": False}
        cli.json_write(job / "batch-report.json", report)
        report_path = publish(job / "batch-report.json", folder, "出图报告_" + job.name, "json")
    report["report_path"] = str(report_path)
    report["job_dir"] = str(job)
    return report


def main():
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    parser = argparse.ArgumentParser(description="PSD 核心及桌面任务入口")
    parser.add_argument("--request", required=True, type=Path)
    parser.add_argument("--job", required=True, type=Path)
    args = parser.parse_args()
    job = args.job.resolve()
    job.mkdir(parents=True, exist_ok=True)
    try:
        request = json.loads(args.request.read_text(encoding="utf-8-sig"))
        config = configuration(request.get("settings", {}), job)
        operation = request["operation"]
        if operation == "workbook":
            result = workbook(request["excel"], config)
        elif operation == "inspect":
            result = inspect_files(request["files"], config)
        elif operation == "preview":
            documents = inspect_files(request["files"], config)
            book = workbook(request["excel"], config)
            result = {"documents": documents, "book": book,
                      "mapping": None if book["needs_sheet"] else matches(documents, book, config, request.get("manual", {}))}
        elif operation == "export":
            result = export_batch(request, config, job)
        elif operation == "diagnose":
            cli.diagnose(config, job, cli.Journal(job / "run.jsonl"))
            result = {"ok": True, "job_dir": str(job)}
        elif operation == "logs":
            destination = Path(request["destination"]).resolve()
            temporary = job / "logs.zip"
            with zipfile.ZipFile(temporary, "w", zipfile.ZIP_DEFLATED) as archive:
                archive.writestr("environment.json", json.dumps({"system": platform.platform(), "architecture": platform.machine(), "python": sys.version}, ensure_ascii=False))
                for path in cli.ROOT.rglob("*"):
                    if path.is_file() and not path.is_symlink() and path.suffix.lower() in (".json", ".jsonl", ".txt", ".log"):
                        archive.write(path, "psd/" + path.relative_to(cli.ROOT).as_posix())
                old_log = cli.ROOT.parent / "worker.log"
                if old_log.is_file():
                    archive.write(old_log, "image-translation/worker.log")
            os.replace(temporary, destination)
            result = {"path": str(destination)}
        else:
            raise ValueError("未知操作：" + str(operation))
        cli.json_write(job / "response.json", {"ok": True, "result": result})
        emit("result", ok=True, result=result)
        return 0
    except Exception as error:
        response = {"ok": False, "error": str(error), "traceback": traceback.format_exc(), "job_dir": str(job)}
        cli.json_write(job / "response.json", response)
        emit("result", **response)
        return 1


if __name__ == "__main__":
    sys.exit(main())

