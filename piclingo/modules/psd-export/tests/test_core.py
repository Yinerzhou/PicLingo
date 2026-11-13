"""【待 Mac 实机验证】独立测试 Excel、配置与日志，测试数据均位于模块目录。"""
import copy
import json
import struct
import sys
import tempfile
import unittest
import zlib
from unittest.mock import patch
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from openpyxl import Workbook
from cli import ROOT, Journal, inspect_png, invoke_bridge, load_config, make_driver, photoshop_lock, tag_srgb
from excel_map import language_code, normalize_text, read_excel


class ExcelTests(unittest.TestCase):
    def setUp(self):
        self.config = load_config(ROOT / "config.json")
        self.temp = tempfile.TemporaryDirectory(dir=ROOT / "tests")
        self.folder = Path(self.temp.name)
        self.events = []

    def tearDown(self):
        self.temp.cleanup()

    def log(self, *args, **kwargs):
        self.events.append((args, kwargs))

    def excel(self, headers, rows, second=False):
        path = self.folder / "中文 空格.xlsx"
        book = Workbook()
        book.active.append(headers)
        for row in rows:
            book.active.append(row)
        if second:
            book.create_sheet("Second")
        book.save(path)
        book.close()
        return path

    def test_template_and_aliases(self):
        for header in ("de", "DE", "German", "德语"):
            path = self.excel(["Key", "en", header], [["title", "Hello", "Hallo"]])
            language, entries = read_excel(path, "German", self.config, self.log)
            self.assertEqual(language, "de")
            self.assertEqual(entries[0]["match"], "Hello")
            self.assertEqual(entries[0]["translation"], "Hallo")

    def test_english_first(self):
        for header in ("EN", "English", "英文", "原文", "英文原文", "待翻译内容"):
            path = self.excel([header, "日文"], [["Hello", "こんにちは"]])
            self.assertEqual(read_excel(path, "ja", self.config, self.log)[1][0]["match"], "Hello")

    def test_duplicates_and_empty(self):
        path = self.excel(["en", "de"], [["Hello", "Hallo"], ["Hello", "Falsch"], ["Empty", None]])
        entries = read_excel(path, "de", self.config, self.log)[1]
        self.assertEqual(len(entries), 2)
        self.assertEqual(entries[0]["translation"], "Hallo")
        self.assertIsNone(entries[1]["translation"])
        self.assertTrue(any(event[0][0] == "warning" for event in self.events))

    def test_key_mode(self):
        self.config["match_by"] = "key"
        path = self.excel(["Key", "de"], [["headline", "Hallo"]])
        self.assertEqual(read_excel(path, "de", self.config, self.log)[1][0]["match"], "headline")

    def test_duplicate_error(self):
        self.config["duplicates"] = "error"
        path = self.excel(["en", "de"], [["Hello", "A"], ["Hello", "B"]])
        with self.assertRaisesRegex(ValueError, "重复"):
            read_excel(path, "de", self.config, self.log)

    def test_ambiguous_language(self):
        path = self.excel(["en", "de", "German"], [["Hello", "A", "B"]])
        with self.assertRaisesRegex(ValueError, "多个表头"):
            read_excel(path, "de", self.config, self.log)

    def test_missing_language(self):
        path = self.excel(["en", "de"], [["Hello", "Hallo"]])
        with self.assertRaisesRegex(ValueError, "未找到"):
            read_excel(path, "ja", self.config, self.log)

    def test_multiple_sheets_require_selection(self):
        path = self.excel(["en", "de"], [["Hello", "Hallo"]], second=True)
        with self.assertRaisesRegex(ValueError, "多个工作表"):
            read_excel(path, "de", self.config, self.log)
        self.config["worksheet"] = "Sheet"
        self.assertEqual(len(read_excel(path, "de", self.config, self.log)[1]), 1)

    def test_formula_rejected(self):
        path = self.excel(["en", "de"], [["Hello", '=CONCAT("Ha","llo")']])
        with self.assertRaisesRegex(ValueError, "公式"):
            read_excel(path, "de", self.config, self.log)

    def test_normalization(self):
        self.assertEqual(normalize_text("  Hello\r\nWorld  ", self.config), "Hello\nWorld")
        path = self.excel(["en", "de"], [["  Hello\nWorld  ", "Hallo"]])
        self.assertEqual(read_excel(path, "de", self.config, self.log)[1][0]["match"], "Hello\nWorld")

    def test_custom_language(self):
        self.config["language_aliases"]["it"] = ["意大利语"]
        self.assertEqual(language_code("意大利语", self.config), "it")

    def test_rtl_gate(self):
        path = self.excel(["en", "ar"], [["Hello", "مرحبا"]])
        with self.assertRaisesRegex(ValueError, "RTL"):
            read_excel(path, "ar", self.config, self.log)

    def test_driver_escapes_paths_and_quotes(self):
        request = {"input": 'C:/中文 空格/a"b.psd', "translation": '";throw 1;//\nこんにちは'}
        driver = make_driver(request, self.folder)
        source = driver.read_text(encoding="utf-8")
        literal = source.split("var PL_REQUEST = ", 1)[1].split(";\n", 1)[0]
        self.assertEqual(json.loads(literal), request)
        self.assertTrue(source.isascii() is False)  # 文件顶部保留中文待验证标注。

    def test_png_validation(self):
        path = self.folder / "bad.png"
        path.write_bytes(b"not an image")
        with self.assertRaisesRegex(ValueError, "PNG"):
            inspect_png(path)

    def test_srgb_tag_preserves_png(self):
        def chunk(kind, data):
            return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)
        path = self.folder / "sample.png"
        pixels = zlib.compress(b"\x00\xff\xff\xff")
        path.write_bytes(b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", 1, 1, 8, 2, 0, 0, 0)) +
                         chunk(b"IDAT", pixels) + chunk(b"IEND", b""))
        self.assertEqual(inspect_png(path), (1, 1))
        self.assertTrue(tag_srgb(path))
        self.assertEqual(inspect_png(path), (1, 1))
        self.assertIn(b"sRGB\x01", path.read_bytes())
        self.assertIn(pixels, path.read_bytes())
        self.assertFalse(tag_srgb(path))

    def test_config_blocks_future_format(self):
        config = copy.deepcopy(self.config)
        config["output"]["format"] = "webp"
        path = self.folder / "config.json"
        path.write_text(json.dumps(config), encoding="utf-8")
        with self.assertRaisesRegex(ValueError, "输出支持"):
            load_config(path)

    def test_duplicate_key_detected_in_source_mode(self):
        path = self.excel(["Key", "en", "de"], [["title", "Hello", "Hallo"], ["title", "Other", "Andere"]])
        self.assertEqual(len(read_excel(path, "de", self.config, self.log)[1]), 1)

    def test_alias_collision_rejected(self):
        config = copy.deepcopy(self.config)
        config["language_aliases"]["de"].append("English")
        path = self.folder / "config.json"
        path.write_text(json.dumps(config), encoding="utf-8")
        with self.assertRaisesRegex(ValueError, "重复映射"):
            load_config(path)

    def test_concurrent_task_rejected(self):
        with patch("cli.ROOT", self.folder):
            with photoshop_lock():
                with self.assertRaisesRegex(RuntimeError, "另一个 PSD 任务"):
                    with photoshop_lock():
                        pass

    def test_timeout_blocks_later_tasks(self):
        # 模拟调用进程挂起，用于验证超时及恢复标记，未调用真实 Photoshop。
        (self.folder / "runs").mkdir()
        config = copy.deepcopy(self.config)
        config["photoshop"]["probe_timeout_seconds"] = 0.1
        # Windows venv 的 python.exe 是转发启动器，直接使用实际解释器避免孤立测试子进程。
        command = [getattr(sys, "_base_executable", sys.executable), "-c", "import time;time.sleep(30)"]
        with patch("cli.ROOT", self.folder), patch("cli.bridge_command", return_value=command):
            with self.assertRaises(TimeoutError):
                invoke_bridge(config, self.folder / "unused.jsx", self.folder, Journal(self.folder / "log.jsonl"), probe=True)
            marker = self.folder / "runs" / "RECOVERY_REQUIRED.json"
            self.assertTrue(marker.exists())
            with self.assertRaisesRegex(RuntimeError, "执行状态不确定"):
                with photoshop_lock():
                    pass

    def test_failed_bridge_has_raw_output(self):
        config = copy.deepcopy(self.config)
        command = [getattr(sys, "_base_executable", sys.executable), "-c", "import sys;print('test-error');sys.exit(2)"]
        with patch("cli.bridge_command", return_value=command):
            with self.assertRaisesRegex(RuntimeError, "退出码 2"):
                invoke_bridge(config, self.folder / "unused.jsx", self.folder, Journal(self.folder / "log.jsonl"), probe=True)
        self.assertIn("test-error", (self.folder / "probe-output.txt").read_text())

    def test_bridge_details_preserve_error_message(self):
        event = {"level": "error", "step": "恢复设置", "message": "失败", "details": {"message": "原始异常", "number": 45}}
        transport = self.folder / "probe-transport.jsonl"
        script = "from pathlib import Path;Path(%s).write_text(%s,encoding='utf-8')" % (
            repr(str(transport)), repr(json.dumps(event, ensure_ascii=False) + "\n"))
        command = [getattr(sys, "_base_executable", sys.executable), "-c", script]
        with patch("cli.bridge_command", return_value=command):
            invoke_bridge(self.config, self.folder / "unused.jsx", self.folder, Journal(self.folder / "log.jsonl"), probe=True)
        merged = json.loads((self.folder / "log.jsonl").read_text(encoding="utf-8").splitlines()[0])
        self.assertEqual(merged["details"]["source_details"]["message"], "原始异常")


if __name__ == "__main__":
    unittest.main(verbosity=2)
