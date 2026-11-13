"""隔离原 worker 的下载函数，验证重定向和模型摘要边界。"""
import ast
import hashlib
import sys
import tempfile
import types
import unittest
from pathlib import Path
from unittest.mock import patch
from urllib.parse import urlparse


class Response:
    def __init__(self, code=200, location=None):
        self.status_code = code
        self.headers = {"Location": location} if location else {}
    def close(self): pass
    def raise_for_status(self): pass
    def iter_content(self, size): return iter([b"model-test-bytes"])
    def __enter__(self): return self
    def __exit__(self, *args): pass


class DownloadTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        root = Path(__file__).resolve().parents[3]
        tree = ast.parse((root / "work/app/worker.py").read_text(encoding="utf-8-sig"))
        serve = next(node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name == "serve")
        install = next(node for node in serve.body if isinstance(node, ast.FunctionDef) and node.name == "install")
        self.entry = {"from_code": "en", "to_code": "de", "links": ["https://models.example/model.argosmodel"]}
        self.installed = []
        namespace = {"find_model": lambda *args: False, "index": [self.entry], "DATA": Path(self.temp.name), "tempfile": tempfile, "Path": Path, "urlparse": urlparse, "hashlib": hashlib, "sys": sys, "extract_model": lambda *args: self.installed.append(True)}
        exec(compile(ast.Module(body=[install], type_ignores=[]), "worker-install", "exec"), namespace)
        self.install = namespace["install"]

    def run_download(self, responses):
        sequence = iter(responses)
        module = types.ModuleType("requests")
        module.get = lambda *args, **kwargs: next(sequence)
        with patch.dict(sys.modules, {"requests": module}):
            self.install("en", "de", lambda text: None)

    def test_https_same_origin_redirect(self):
        self.entry["sha256"] = hashlib.sha256(b"model-test-bytes").hexdigest()
        self.run_download([Response(302, "/next"), Response()])
        self.assertEqual(self.installed, [True])

    def test_insecure_and_foreign_redirect(self):
        for url in ["http://models.example/file", "https://other.example/file"]:
            with self.subTest(url=url), self.assertRaises(ValueError):
                self.run_download([Response(302, url)])
        self.assertEqual(self.installed, [])

    def test_hash_mismatch(self):
        self.entry["sha256"] = "0" * 64
        with self.assertRaisesRegex(ValueError, "SHA256"):
            self.run_download([Response()])
        self.assertEqual(self.installed, [])

