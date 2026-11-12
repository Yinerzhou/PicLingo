"""【待 Mac 实机验证】PSD 阶段 1 命令行入口，全部状态写入独立任务目录。"""
import argparse
import contextlib
import hashlib
import json
import os
import platform
import shutil
import struct
import subprocess
import sys
import time
import traceback
import uuid
import zlib
from pathlib import Path

from excel_map import header_token, read_excel

RESOURCE_ROOT = Path(getattr(sys, "_MEIPASS", Path(__file__).resolve().parent))
ROOT = Path(os.environ.get("PICLINGO_PSD_HOME", str(RESOURCE_ROOT)))


def json_write(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding="utf-8")


def file_hash(path):
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


class Journal:
    def __init__(self, path):
        self.path = path
        self.step = "初始化"

    def __call__(self, level, step, message, **details):
        event = {"time": time.strftime("%Y-%m-%dT%H:%M:%S%z"), "level": level,
                 "step": step, "message": message, "details": details}
        with self.path.open("a", encoding="utf-8") as stream:
            stream.write(json.dumps(event, ensure_ascii=False) + "\n")
        print(json.dumps(event, ensure_ascii=False), flush=True)

    @contextlib.contextmanager
    def timing(self, name):
        self.step = name
        started = time.monotonic()
        self("info", name, "开始")
        try:
            yield
        except BaseException:
            self("error", name, "步骤失败", elapsed_ms=round((time.monotonic() - started) * 1000))
            raise
        else:
            self("info", name, "完成", elapsed_ms=round((time.monotonic() - started) * 1000))


def load_config(path):
    config = json.loads(path.read_text(encoding="utf-8-sig"))
    allowed = {
        "match_by": ("source", "key", "manual"), "hidden_layers": ("skip", "include"),
        "duplicates": ("first_warn", "error"), "empty_translation": ("keep_warn", "error"),
        "unmatched": ("keep_report", "error"), "missing_font": ("skip_report", "error")
    }
    for key, choices in allowed.items():
        if config[key] not in choices:
            raise ValueError("配置 %s 必须为 %s" % (key, choices))
    output = config["output"]
    if output["format"] not in ("png", "jpg", "psd") or output["size"] != "original":
        raise ValueError("输出支持原尺寸 PNG / JPG / PSD")
    if output["overwrite"]:
        raise ValueError("阶段 1 使用禁止覆盖输出的策略，请另选输出文件名")
    if config["overflow"]["strategy"] not in ("warn", "shrink"):
        raise ValueError("溢出策略必须为 warn 或 shrink")
    if not 1 <= float(config["overflow"]["minimum_font_size"]) <= 1000:
        raise ValueError("最小字号必须为 1～1000")
    if not 0 <= int(output["jpg_quality"]) <= 100:
        raise ValueError("JPG 质量必须为 0～100")
    smart = config["smart_objects"]
    if smart["embedded"] not in ("process", "skip") or smart["linked"] != "report":
        raise ValueError("智能对象配置仅支持 embedded=process/skip，linked=report")
    if not isinstance(smart["max_depth"], int) or not 0 <= smart["max_depth"] <= 20:
        raise ValueError("智能对象最大深度必须为 0～20")
    ps = config["photoshop"]
    for key in ("retry_delay_seconds", "probe_timeout_seconds", "task_timeout_seconds", "expected_major"):
        if not isinstance(ps[key], int) or ps[key] <= 0:
            raise ValueError("photoshop.%s 必须为正整数" % key)
    if not isinstance(ps["busy_retries"], int) or not 0 <= ps["busy_retries"] <= 10:
        raise ValueError("busy_retries 必须为 0～10")
    if ps["task_timeout_seconds"] < 5:
        raise ValueError("task_timeout_seconds 至少为 5 秒")
    if not config["photoshop"]["suppress_dialogs"]:
        raise ValueError("自动化必须启用 suppress_dialogs，避免无人值守时弹窗阻塞")
    if config["header_row"] < 1:
        raise ValueError("header_row 从 1 开始")
    aliases_seen = {}
    for code, aliases in config["language_aliases"].items():
        for alias in [code] + aliases:
            token = header_token(alias)
            if not token:
                raise ValueError("语言别名不能为空")
            if token in aliases_seen and aliases_seen[token] != code:
                raise ValueError("语言别名重复映射：" + str(alias))
            aliases_seen[token] = code
    return config


@contextlib.contextmanager
def photoshop_lock():
    # 操作系统锁在进程退出时释放，文件保留，避免删除锁文件造成并发窗口。
    lock_path = ROOT / "runs" / "photoshop.lock"
    lock_path.parent.mkdir(parents=True, exist_ok=True)
    with lock_path.open("a+b") as stream:
        stream.seek(0, os.SEEK_END)
        if stream.tell() == 0:
            stream.write(b"0")
            stream.flush()
        stream.seek(0)
        try:
            if os.name == "nt":
                import msvcrt
                msvcrt.locking(stream.fileno(), msvcrt.LK_NBLCK, 1)
            else:
                import fcntl
                fcntl.flock(stream.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError as error:
            raise RuntimeError("另一个 PSD 任务正在使用 Photoshop，请等待任务结束") from error
        try:
            marker = ROOT / "runs" / "RECOVERY_REQUIRED.json"
            if marker.exists():
                raise RuntimeError("之前的调用超时且执行状态不确定，请先检查 " + str(marker) + "，按 README 恢复后再运行")
            yield
        finally:
            stream.seek(0)
            if os.name == "nt":
                msvcrt.locking(stream.fileno(), msvcrt.LK_UNLCK, 1)
            else:
                fcntl.flock(stream.fileno(), fcntl.LOCK_UN)


def bridge_command(config, driver, transport, probe=False):
    ps = config["photoshop"]
    if sys.platform == "win32":
        powershell = shutil.which("powershell.exe")
        if not powershell:
            raise RuntimeError("找不到 Windows PowerShell")
        command = [powershell, "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-STA",
                   "-File", str(RESOURCE_ROOT / "adapters" / "windows.ps1"), "-Driver", str(driver),
                   "-TransportLog", str(transport), "-ProgId", ps["windows_progid"],
                   "-Retries", str(ps["busy_retries"]), "-DelaySeconds", str(ps["retry_delay_seconds"])]
        if probe:
            command.append("-Probe")
        return command
    if sys.platform == "darwin":
        app = Path(ps["mac_application"]).expanduser()
        if not app.is_dir():
            raise FileNotFoundError("未找到 Photoshop 应用，请修改 photoshop.mac_application：" + str(app))
        code = ('"PICLINGO_PROBE:" + app.version + ":documents=" + app.documents.length;'
                if probe else "$.evalFile(File(" + json.dumps(str(driver), ensure_ascii=True) + "));" )
        timeout = ps["probe_timeout_seconds"] if probe else ps["task_timeout_seconds"]
        return ["/usr/bin/osascript", str(RESOURCE_ROOT / "adapters" / "macos.applescript"), str(app), code,
                str(timeout), str(ps["busy_retries"]), str(ps["retry_delay_seconds"])]
    raise RuntimeError("当前仅支持 Windows 和 macOS")


def invoke_bridge(config, driver, run_dir, log, probe=False):
    transport = run_dir / ("probe-transport.jsonl" if probe else "transport.jsonl")
    command = bridge_command(config, driver, transport, probe)
    timeout = config["photoshop"]["probe_timeout_seconds" if probe else "task_timeout_seconds"]
    offsets = {}
    paths = [transport] if probe else [transport, run_dir / "photoshop.jsonl"]

    def pump():
        for path in paths:
            if not path.exists():
                continue
            with path.open("rb") as stream:
                stream.seek(offsets.get(path, 0))
                chunk = stream.read()
            end = chunk.rfind(b"\n") + 1
            if end:
                for line in chunk[:end].decode("utf-8-sig").splitlines():
                    if not line.strip():
                        continue
                    event = json.loads(line)
                    log(event.get("level", "info"), event.get("step", "Photoshop"),
                        event.get("message", ""), source_details=event.get("details", {}))
                offsets[path] = offsets.get(path, 0) + end

    stdout_path = run_dir / ("probe-output.txt" if probe else "bridge-output.txt")
    with stdout_path.open("wb") as output:
        process = subprocess.Popen(command, stdout=output, stderr=subprocess.STDOUT)
        started = time.monotonic()
        try:
            while process.poll() is None:
                pump()
                if time.monotonic() - started > timeout:
                    raise TimeoutError("调用超过 %s 秒，Photoshop 可能处于对话框、忙碌状态或仍在执行" % timeout)
                time.sleep(0.2)
        except BaseException:
            # 只终止调用进程，禁止强制关闭用户的 Photoshop。
            if process.poll() is None:
                process.kill()
            process.wait()
            json_write(ROOT / "runs" / "RECOVERY_REQUIRED.json", {
                "run_dir": str(run_dir), "probe": probe,
                "message": "调用中断。检查 Photoshop 是否仍忙碌、是否有未完成脚本及文档，再按 README 恢复。"})
            raise
        finally:
            pump()
    raw_output = stdout_path.read_text(encoding="utf-8-sig", errors="replace")
    if raw_output.strip():
        log("info" if process.returncode == 0 else "error", "桥接输出", raw_output.strip())
    if process.returncode:
        raise RuntimeError("Photoshop 桥接失败，退出码 %s，完整输出见 %s" % (process.returncode, stdout_path))
    return raw_output


def make_driver(request, run_dir):
    driver = run_dir / "driver.jsx"
    # ASCII JSON 字面量兼容 ES3，并避免路径和译文被当作脚本代码。
    source = "// 【待 Mac 实机验证】此文件由命令行生成。\n"
    source += "var PL_REQUEST = " + json.dumps(request, ensure_ascii=True) + ";\n"
    source += "$.evalFile(File(" + json.dumps(str(RESOURCE_ROOT / "photoshop" / "shared.jsx"), ensure_ascii=True) + "));\n"
    driver.write_text(source, encoding="utf-8")
    return driver


def inspect_png(path):
    with path.open("rb") as stream:
        data = stream.read(24)
    if len(data) != 24 or data[:8] != b"\x89PNG\r\n\x1a\n" or data[12:16] != b"IHDR":
        raise ValueError("输出不是有效 PNG 文件")
    dimensions = struct.unpack(">II", data[16:24])
    if not all(dimensions):
        raise ValueError("PNG 尺寸无效")
    with path.open("rb") as stream:
        stream.seek(8)
        image_data = False
        while True:
            header = stream.read(8)
            if len(header) != 8:
                raise ValueError("PNG 缺少结束块")
            length, kind = struct.unpack(">I4s", header)
            # 流式校验，避免将大图片的单个数据块一次载入内存。
            checksum = zlib.crc32(kind)
            remaining = length
            while remaining:
                block = stream.read(min(remaining, 1024 * 1024))
                if not block:
                    raise ValueError("PNG 数据不完整")
                checksum = zlib.crc32(block, checksum)
                remaining -= len(block)
            expected = stream.read(4)
            if len(expected) != 4 or checksum & 0xFFFFFFFF != struct.unpack(">I", expected)[0]:
                raise ValueError("PNG 数据校验失败")
            image_data = image_data or kind == b"IDAT"
            if kind == b"IEND":
                if not image_data or length or stream.read(1):
                    raise ValueError("PNG 结束块异常")
                break
    return dimensions


def tag_srgb(path):
    # 部分 Photoshop 版本的 PNG saveAs 仅写 XMP，补标准 sRGB 块以明确颜色解释。
    # 此操作仅用于已在 Photoshop 中转换为标准 sRGB 的像素，不重新编码图像。
    with path.open("rb") as stream:
        stream.seek(8)
        while True:
            length, kind = struct.unpack(">I4s", stream.read(8))
            if kind in (b"sRGB", b"iCCP"):
                return False
            stream.seek(length + 4, 1)
            if kind == b"IEND":
                break
    payload = b"\x01"
    chunk = struct.pack(">I", len(payload)) + b"sRGB" + payload
    chunk += struct.pack(">I", zlib.crc32(b"sRGB" + payload) & 0xFFFFFFFF)
    temporary = path.with_name(path.name + ".tagged")
    try:
        with path.open("rb") as source, temporary.open("xb") as destination:
            destination.write(source.read(33))  # PNG 签名及 IHDR 块。
            destination.write(chunk)
            shutil.copyfileobj(source, destination)
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)
    return True


def diagnose(config, run_dir, log):
    with log.timing("环境诊断"):
        log("info", "系统信息", "当前环境", system=platform.platform(), architecture=platform.machine(),
            python=sys.version, executable=sys.executable, mac_validation="待 Mac 实机验证")
        if sys.platform == "darwin":
            for command in (["/usr/bin/sw_vers"], ["/usr/bin/uname", "-m"]):
                result = subprocess.run(command, capture_output=True, text=True, timeout=10)
                log("info", "系统信息", result.stdout.strip(), stderr=result.stderr, returncode=result.returncode)
        invoke_bridge(config, run_dir / "unused.jsx", run_dir, log, probe=True)
        log("info", "自动化权限", "当前启动程序已成功发送只读脚本并收到响应。此结果仅适用于当前启动程序和当前用户。")


def execute(args, config, run_dir, log):
    with log.timing("输入检查"):
        psd = Path(args.psd).expanduser().resolve(strict=True)
        excel = Path(args.excel).expanduser().resolve(strict=True)
        output = Path(args.out).expanduser().resolve()
        output_format = config["output"]["format"]
        if psd.suffix.lower() != ".psd" or excel.suffix.lower() != ".xlsx" or output.suffix.lower() != "." + output_format:
            raise ValueError("输入必须为 PSD 与 XLSX，输出扩展名必须与配置格式一致")
        if output.exists():
            raise FileExistsError("输出已存在，请更换文件名：" + str(output))
        output.parent.mkdir(parents=True, exist_ok=True)
        before = file_hash(psd)
        log("info", "输入检查", "原始 PSD 哈希", path=str(psd), sha256=before)
    with log.timing("读取Excel"):
        target, entries = read_excel(excel, args.lang, config, log)
    with log.timing("连接探测"):
        invoke_bridge(config, run_dir / "unused.jsx", run_dir, log, probe=True)
    staging = output.parent / (".piclingo-" + run_dir.name + "." + output_format)
    request = {
        "action": "translate", "input": str(psd), "output": str(staging), "target": target,
        "entries": entries, "config": config,
        "event_file": str(run_dir / "photoshop.jsonl"), "result_file": str(run_dir / "result.json"),
        "started_file": str(run_dir / "started.txt"),
        "deadline": int((time.time() + config["photoshop"]["task_timeout_seconds"] - 2) * 1000)
    }
    driver = make_driver(request, run_dir)
    result = None
    published = False
    try:
        with log.timing("Photoshop处理"):
            invoke_bridge(config, driver, run_dir, log)
            result_path = run_dir / "result.json"
            if not result_path.exists():
                raise RuntimeError("脚本未生成结果，检查 Photoshop 日志及脚本加载错误")
            result = json.loads(result_path.read_text(encoding="utf-8-sig"))
            if not result["ok"]:
                raise RuntimeError("%s：%s" % (result.get("failed_step"), result.get("error")))
        with log.timing("输出验收"):
            dimensions = result["dimensions"]
            if output_format == "png" and list(inspect_png(staging)) != dimensions:
                raise ValueError("PNG 尺寸与原始 PSD 不一致")
            if output_format == "png" and config["output"]["color_profile"] == "sRGB IEC61966-2.1":
                tagged = tag_srgb(staging)
                inspect_png(staging)
                log("info", "颜色标记", "标准 sRGB 颜色信息已核对", added_srgb_chunk=tagged)
            if file_hash(psd) != before:
                raise RuntimeError("原始 PSD 哈希发生变化，请检查是否存在外部修改")
            # 排他创建防止并发覆盖，复制完成后才记录成功。失败时删除自己的半成品。
            created = False
            try:
                with output.open("xb") as destination:
                    created = True
                    with staging.open("rb") as source:
                        shutil.copyfileobj(source, destination)
                    destination.flush()
                    os.fsync(destination.fileno())
            except BaseException:
                if created:
                    output.unlink(missing_ok=True)
                raise
            published = True
            log("info", "导出完成", output_format.upper() + " 已生成", output=str(output), dimensions=dimensions,
                sha256=file_hash(output), report=str(run_dir / "report.json"))
    finally:
        unchanged = file_hash(psd) == before
        json_write(run_dir / "report.json", {"success": published, "input": str(psd), "output": str(output),
                   "language": target, "source_unchanged": unchanged, "photoshop": result,
                   "notes": ["富文本按相对字符区间映射", "RTL 为实验功能，待客户验收"]})
        if not (ROOT / "runs" / "RECOVERY_REQUIRED.json").exists():
            staging.unlink(missing_ok=True)
        log("info" if unchanged else "error", "原稿检查", "原始 PSD 校验结束", unchanged=unchanged)


def create_fixture(args, config, run_dir, log):
    folder = Path(args.make_fixture).expanduser().resolve()
    folder.mkdir(parents=True, exist_ok=True)
    fixture_paths = [folder / name for name in ("最小 测试 1层.psd", "多层 测试 3层.psd")]
    if any(path.exists() for path in fixture_paths):
        raise FileExistsError("测试 PSD 已存在，请更换样本目录，防止覆盖")
    request = {"action": "fixture", "folder": str(folder), "config": config,
               "event_file": str(run_dir / "photoshop.jsonl"), "result_file": str(run_dir / "result.json"),
               "started_file": str(run_dir / "started.txt"),
               "deadline": int((time.time() + config["photoshop"]["task_timeout_seconds"] - 2) * 1000)}
    with log.timing("生成测试PSD"):
        invoke_bridge(config, make_driver(request, run_dir), run_dir, log)
        result = json.loads((run_dir / "result.json").read_text(encoding="utf-8-sig"))
        if not result["ok"]:
            raise RuntimeError(result.get("error"))
        for path in fixture_paths:
            if not path.is_file():
                raise RuntimeError("缺少测试文件：" + str(path))


def main():
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    parser = argparse.ArgumentParser(description="PicLingo PSD 阶段 1 命令行")
    parser.add_argument("--config", type=Path, default=RESOURCE_ROOT / "config.json")
    parser.add_argument("--psd")
    parser.add_argument("--excel")
    parser.add_argument("--lang")
    parser.add_argument("--out")
    parser.add_argument("--diagnose", action="store_true")
    parser.add_argument("--make-fixture", metavar="目录")
    args = parser.parse_args()
    if sum([args.diagnose, bool(args.make_fixture), bool(args.psd or args.excel or args.lang or args.out)]) != 1:
        parser.error("请选择诊断、生成测试 PSD 或翻译中的一种操作")
    if not args.diagnose and not args.make_fixture and not all([args.psd, args.excel, args.lang, args.out]):
        parser.error("翻译需要同时提供 --psd --excel --lang --out")
    run_dir = ROOT / "runs" / (time.strftime("%Y%m%d-%H%M%S") + "-" + uuid.uuid4().hex[:8])
    run_dir.mkdir(parents=True)
    log = Journal(run_dir / "run.jsonl")
    print("任务日志目录 " + str(run_dir), flush=True)
    try:
        with log.timing("配置检查"):
            config = load_config(args.config.resolve())
            log("info", "配置检查", "使用配置", config=config)
        with photoshop_lock():
            if args.diagnose:
                diagnose(config, run_dir, log)
            elif args.make_fixture:
                create_fixture(args, config, run_dir, log)
            else:
                execute(args, config, run_dir, log)
        log("info", "任务结束", "成功")
        return 0
    except BaseException as error:
        log("error", log.step, str(error), full_error=traceback.format_exc(),
            possible_causes=["输入文件或配置不合法", "Photoshop 未安装或 COM 注册异常",
                             "Photoshop 正忙或有阻塞对话框", "自动化权限被拒绝", "字体、路径或颜色配置不可用"])
        json_write(run_dir / "failure.json", {"step": log.step, "error": str(error), "traceback": traceback.format_exc()})
        return 130 if isinstance(error, KeyboardInterrupt) else 1


if __name__ == "__main__":
    sys.exit(main())
