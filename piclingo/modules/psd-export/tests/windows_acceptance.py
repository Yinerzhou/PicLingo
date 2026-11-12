"""Windows Photoshop 实机验收；只操作模块自有样本及本测试创建的文档。"""
import copy
import json
import struct
import subprocess
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from openpyxl import Workbook
from cli import ROOT, Journal, bridge_command, file_hash, inspect_png, invoke_bridge, json_write, load_config, photoshop_lock


def main():
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    if sys.platform != "win32":
        raise RuntimeError("本验收脚本仅用于 Windows，Mac 请使用 MAC自测.md")
    folder = ROOT / "tests" / ("实机验收 " + time.strftime("%Y%m%d-%H%M%S"))
    folder.mkdir()
    config = load_config(ROOT / "config.json")
    sample = ROOT / "samples" / "测试 样本"
    original = sample / "多层 测试 3层.psd"
    minimal = sample / "最小 测试 1层.psd"
    assert original.is_file() and minimal.is_file(), "先生成测试 PSD"
    results = []
    serial = 0

    def js(source):
        nonlocal serial
        serial += 1
        run = folder / ("host-%02d" % serial)
        run.mkdir()
        driver = run / "test.jsx"
        driver.write_text(source, encoding="utf-8-sig")
        with photoshop_lock():
            invoke_bridge(config, driver, run, Journal(run / "run.jsonl"))
        events = [json.loads(line) for line in (run / "transport.jsonl").read_text(encoding="utf-8-sig").splitlines()]
        return events[-1]["details"]["result"]

    def literal(value):
        return json.dumps(str(value), ensure_ascii=True)

    def run_case(name, psd, excel, expected_replacements, changes=None, success=True):
        before = file_hash(psd) if psd.is_file() else None
        output = folder / (name + ".png")
        case_config = copy.deepcopy(config)
        for key, value in (changes or {}).items():
            case_config[key] = value
        config_path = folder / (name + "-config.json")
        json_write(config_path, case_config)
        command = [sys.executable, str(ROOT / "cli.py"), "--config", str(config_path),
                   "--psd", str(psd), "--excel", str(excel), "--lang", "de", "--out", str(output)]
        process = subprocess.run(command, capture_output=True, text=True, encoding="utf-8", timeout=240)
        (folder / (name + ".log")).write_text(process.stdout + process.stderr, encoding="utf-8")
        assert (process.returncode == 0) == success, name + "\n" + process.stdout[-6000:]
        run_dir = Path(process.stdout.splitlines()[0].removeprefix("任务日志目录 "))
        report_path = run_dir / "report.json"
        report = json.loads(report_path.read_text(encoding="utf-8")) if report_path.exists() else None
        if success:
            assert inspect_png(output) == (1200, 800), name
            assert b"\x00\x00\x00\x01sRGB\x01" in output.read_bytes(), name + " 缺少标准 sRGB 标记"
            assert report["photoshop"]["replacements"] == expected_replacements, name + str(report)
            assert report["photoshop"]["color_profile"] == "sRGB IEC61966-2.1", name
            assert report["source_unchanged"], name
        else:
            assert not output.exists(), name
            assert (run_dir / "failure.json").is_file(), name
        if before:
            assert file_hash(psd) == before, name
        results.append({"name": name, "passed": True, "run": str(run_dir), "report": report})
        print("PASS " + name, flush=True)
        return report

    def make_variant(name, action):
        path = folder / (name + ".psd")
        js("""(function(){
            var oldDialogs=app.displayDialogs;
            var oldActive=app.documents.length ? app.activeDocument : null;
            var previous={}; for(var i=0;i<app.documents.length;i++){previous['$'+app.documents[i].id]=true;}
            var source=null, doc=null;
            try {
                app.displayDialogs=DialogModes.NO;
                source=app.open(File(INPUT)); doc=source.duplicate('PicLingo-test-variant',false);
                if(!previous['$'+source.id]){source.close(SaveOptions.DONOTSAVECHANGES); source=null;}
                app.activeDocument=doc;
                ACTION
                var options=new PhotoshopSaveOptions(); options.layers=true;
                doc.saveAs(File(OUTPUT),options,false,Extension.LOWERCASE);
                return 'ok';
            } finally {
                if(doc){doc.close(SaveOptions.DONOTSAVECHANGES);}
                if(source && !previous['$'+source.id]){source.close(SaveOptions.DONOTSAVECHANGES);}
                if(oldActive){app.activeDocument=oldActive;} app.displayDialogs=oldDialogs;
            }
        }());""".replace("INPUT", literal(original)).replace("OUTPUT", literal(path)).replace("ACTION", action))
        return path

    sentinel = None
    source_id = None
    source_owned = False
    completed = False
    photoshop_version = js("app.version;")
    before_state = js("app.documents.length + '|' + String(app.displayDialogs);")
    try:
        run_case("单层", minimal, sample / "翻译 模板.xlsx", 1)
        run_case("三层", original, sample / "翻译 模板.xlsx", 3)
        run_case("英文首列", original, sample / "英文首列 变体.xlsx", 3)
        run_case("中文表头", original, sample / "中文表头 变体.xlsx", 3)
        run_case("按Key", original, sample / "翻译 模板.xlsx", 3, {"match_by": "key"})
        grouped = make_variant("分组隐藏", """
            var layers=[]; for(var i=0;i<doc.artLayers.length;i++){if(doc.artLayers[i].kind===LayerKind.TEXT){layers.push(doc.artLayers[i]);}}
            var group=doc.layerSets.add(); group.name='测试 组';
            for(var i=0;i<layers.length;i++){if(layers[i].name==='discount'){layers[i].visible=false;} layers[i].move(group,ElementPlacement.INSIDE);}
        """)
        hidden = run_case("隐藏跳过", grouped, sample / "翻译 模板.xlsx", 2)
        assert any(item["status"] == "hidden_skipped" for item in hidden["photoshop"]["layers"])
        run_case("隐藏包含", grouped, sample / "翻译 模板.xlsx", 3, {"hidden_layers": "include"})
        smart = make_variant("内嵌对象", """
            doc.activeLayer=doc.artLayers.getByName('button');
            executeAction(stringIDToTypeID('newPlacedLayer'),new ActionDescriptor(),DialogModes.NO);
        """)
        embedded = run_case("内嵌文字", smart, sample / "翻译 模板.xlsx", 3)
        assert any(item["status"] == "embedded_processed" for item in embedded["photoshop"]["layers"])
        missing = folder / "缺字体.psd"
        data = minimal.read_bytes()
        assert "ArialMT".encode("utf-16-be") in data
        missing.write_bytes(data.replace(b"ArialMT", b"NoFontX").replace("ArialMT".encode("utf-16-be"), "NoFontX".encode("utf-16-be")))
        missing_report = run_case("缺字体跳过", missing, sample / "翻译 模板.xlsx", 0)
        assert missing_report["photoshop"]["layers"][0]["status"] == "missing_font"
        assert "NoFontX" in missing_report["photoshop"]["layers"][0]["fonts"]["missing"]
        run_case("缺字体失败", missing, sample / "翻译 模板.xlsx", 0, {"missing_font": "error"}, success=False)
        book = Workbook()
        book.active.append(["Key", "en", "de"])
        book.active.append(["headline", "Summer Sale", "Sommeraktion"])
        book.active.append(["headline", "Summer Sale", "Wrong"])
        book.active.append(["button", "Shop Now", None])
        unusual = folder / "重复 空译文.xlsx"
        book.save(unusual)
        book.close()
        report = run_case("重复空值未匹配", original, unusual, 1)
        statuses = {item["status"] for item in report["photoshop"]["layers"]}
        assert {"replaced", "unmatched", "empty_kept"} <= statuses
        corrupt = folder / "坏文件.psd"
        corrupt.write_bytes(b"invalid PSD")
        run_case("损坏PSD", corrupt, sample / "翻译 模板.xlsx", 0, success=False)
        strict = copy.deepcopy(config["photoshop"])
        strict["expected_major"] = 999
        strict["strict_version"] = True
        run_case("版本拒绝", minimal, sample / "翻译 模板.xlsx", 0, {"photoshop": strict}, success=False)
        # 用户文档保护：只记录并在 finally 关闭本测试新建的文档。
        sentinel = int(js("app.documents.add(80,80,72,'PicLingo-test-sentinel').id;"))
        state = js("""(function(){var ids={};for(var i=0;i<app.documents.length;i++){ids['$'+app.documents[i].id]=true;}
            var d=app.open(File(INPUT)); return d.id+'|'+(ids['$'+d.id]?'existing':'owned')+'|'+app.documents.length+'|'+String(app.displayDialogs); }());""".replace("INPUT", literal(minimal))).split("|")
        source_id = int(state[0])
        source_owned = state[1] == "owned"
        expected_state = "|".join([state[0], state[2], state[3]])
        run_case("已有文档保护", minimal, sample / "翻译 模板.xlsx", 1)
        actual = js("app.activeDocument.id+'|'+app.documents.length+'|'+String(app.displayDialogs);")
        assert actual == expected_state, (actual, expected_state)
        results.append({"name": "活动文档数量及对话框设置恢复", "passed": True, "state": actual})
        busy_run = folder / "busy-host"
        busy_run.mkdir()
        busy_started = busy_run / "started.txt"
        busy_script = busy_run / "busy.jsx"
        busy_script.write_text("var f=File(" + literal(busy_started) + ");f.open('w');f.write('running');f.close();$.sleep(8000);'BUSY_DONE';", encoding="utf-8-sig")
        busy_config = copy.deepcopy(config)
        busy_config["photoshop"]["probe_timeout_seconds"] = 1
        busy_config["photoshop"]["busy_retries"] = 0
        busy_config_path = folder / "忙碌测试-config.json"
        json_write(busy_config_path, busy_config)
        with (busy_run / "output.txt").open("wb") as busy_output:
            process = subprocess.Popen(bridge_command(config, busy_script, busy_run / "transport.jsonl"), stdout=busy_output, stderr=subprocess.STDOUT)
            try:
                deadline = time.monotonic() + 15
                while not busy_started.exists() and process.poll() is None and time.monotonic() < deadline:
                    time.sleep(0.1)
                assert busy_started.exists(), "忙碌测试未能进入 Photoshop"
                probe = subprocess.run([sys.executable, str(ROOT / "cli.py"), "--config", str(busy_config_path), "--diagnose"],
                                       capture_output=True, text=True, encoding="utf-8", timeout=10)
                (folder / "忙碌超时.log").write_text(probe.stdout + probe.stderr, encoding="utf-8")
                assert probe.returncode != 0, "忙碌期间探测仍可运行，需要另行验证模态阻塞场景"
            finally:
                process.wait(timeout=30)
        marker = ROOT / "runs" / "RECOVERY_REQUIRED.json"
        if marker.exists():
            recovery = json.loads(marker.read_text(encoding="utf-8"))
            assert recovery["probe"], "只允许归档本次只读探测的恢复标记"
            assert recovery["run_dir"] in probe.stdout
            marker.rename(folder / "timeout-recovery-acknowledged.json")
        results.append({"name": "真实Photoshop忙碌及有界失败", "passed": True, "host_exit": process.returncode})
        completed = True
    finally:
        ids = [sentinel] + ([source_id] if source_owned else [])
        ids = [value for value in ids if value is not None]
        if ids:
            js("""(function(){var ids=IDS;for(var i=app.documents.length-1;i>=0;i--){for(var j=0;j<ids.length;j++){
                if(app.documents[i].id===ids[j]){app.documents[i].close(SaveOptions.DONOTSAVECHANGES);break;}}}return 'cleaned';}());""".replace("IDS", json.dumps(ids)))
        after_state = js("app.documents.length + '|' + String(app.displayDialogs);")
        results.append({"name": "测试前后用户文档数量及设置", "passed": before_state == after_state,
                        "before": before_state, "after": after_state})
        json_write(folder / "acceptance.json", {"platform": "Windows", "results": results,
                   "completed": completed, "error": str(sys.exc_info()[1]) if sys.exc_info()[1] else None,
                   "photoshop_version": photoshop_version,
                   "all_passed": completed and all(item["passed"] for item in results),
                   "ps2024_verified": completed and photoshop_version.split(".")[0] == "25", "mac_verified": False})
    print("验收报告 " + str(folder / "acceptance.json"))


if __name__ == "__main__":
    main()
