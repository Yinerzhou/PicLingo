"""PSD 批量模块的匹配、命名、配置与导出不覆盖检查。"""
import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import cli
from service import configuration, matches, output_name, publish, workbook


class BatchTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(dir=cli.RESOURCE_ROOT / "tests")
        self.folder = Path(self.temp.name)
        self.config = configuration({}, self.folder)
        self.book = {"rows": [{"row": 2, "key": "title", "source": "Hello", "translations": {"de": "Hallo"}}]}
        self.docs = [{"ok": True, "path": "中文/test.psd", "layers": [{"route": "0", "name": "title", "original": "Hello"}]}]

    def tearDown(self):
        self.temp.cleanup()

    def test_source_key_and_manual(self):
        for mode in ("source", "key", "manual"):
            self.config["match_by"] = mode
            mapping = matches(self.docs, self.book, self.config, {"中文/test.psd": {"0": 2}})
            self.assertEqual(mapping["layers"][0]["status"], "matched")
            self.assertEqual(mapping["unused_rows"], [])

    def test_unmatched_extra(self):
        self.docs[0]["layers"][0]["original"] = "Other"
        mapping = matches(self.docs, self.book, self.config, {})
        self.assertEqual(mapping["layers"][0]["status"], "unmatched")
        self.assertEqual(len(mapping["unused_rows"]), 1)

    def test_naming(self):
        self.assertEqual(output_name("{文件名}_{语言}", "中文 空格.psd", "de"), "中文 空格_de")
        self.assertNotIn("/", output_name("../{filename}/{language}", "test.psd", "de"))
        self.assertEqual(output_name("CON", "test.psd", "de"), "_CON")
        with self.assertRaises(ValueError):
            output_name("{unknown}", "test.psd", "de")

    def test_publish_never_overwrites(self):
        staging = self.folder / "temporary.png"
        staging.write_bytes(b"new")
        existing = self.folder / "image.png"
        existing.write_bytes(b"old")
        output = publish(staging, self.folder, "image", "png")
        self.assertEqual(output.name, "image_2.png")
        self.assertEqual(existing.read_bytes(), b"old")
        self.assertEqual(output.read_bytes(), b"new")

    def test_all_formats_and_shrink(self):
        for format_name in ("png", "jpg", "psd"):
            config = configuration({"output": {"format": format_name}, "overflow": {"strategy": "shrink"}}, self.folder)
            self.assertEqual(config["output"]["format"], format_name)

    def test_config_bounds(self):
        for settings in ({"output": {"jpg_quality": 101}}, {"overflow": {"minimum_font_size": 0}}):
            with self.assertRaises(ValueError):
                configuration(settings, self.folder)

    def test_workbook_auto_detect(self):
        path = cli.RESOURCE_ROOT / "samples/测试 样本/英文首列 变体.xlsx"
        book = workbook(path, self.config)
        self.assertEqual([language["code"] for language in book["languages"]], ["de", "fr", "ja"])
        self.assertEqual(len(book["rows"]), 3)


if __name__ == "__main__":
    unittest.main(verbosity=2)
