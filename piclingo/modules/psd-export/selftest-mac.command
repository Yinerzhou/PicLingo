#!/bin/bash
# 【待 Mac 实机验证】前提为已安装 Python 3.10+、Photoshop 2024，并且允许自动化。
set -euo pipefail
module_dir="$(cd "$(dirname "$0")" && pwd)"
cd "$module_dir"
target_dir="$module_dir/tests/Mac自测-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$target_dir"
exec > >(/usr/bin/tee "$target_dir/selftest.txt") 2>&1
trap 'status=$?; if [ "$status" -ne 0 ]; then echo "自测失败，退出码 $status。请发送本目录及 runs 中最新任务日志。"; fi' EXIT
echo '【待 Mac 实机验证】开始 Mac 最小链路自测'
/usr/bin/sw_vers
/usr/bin/uname -m
if [ ! -x .venv/bin/python ]; then
    if ! command -v python3 >/dev/null 2>&1; then
        echo '请先安装 Python 3.10 或更高版本，再重新运行。'
        exit 1
    fi
    python3 -m venv .venv
fi
.venv/bin/python -c 'import sys; assert sys.version_info >= (3,10), "需要 Python 3.10+"'
if [ -d dependencies ]; then
    .venv/bin/python -m pip install --no-index --find-links dependencies -r requirements.txt
else
    .venv/bin/python -m pip install -r requirements.txt
fi
.venv/bin/python cli.py --diagnose
.venv/bin/python cli.py --psd 'samples/测试 样本/最小 测试 1层.psd' \
  --excel 'samples/测试 样本/翻译 模板.xlsx' --lang de --out "$target_dir/单层_de.png"
.venv/bin/python cli.py --psd 'samples/测试 样本/多层 测试 3层.psd' \
  --excel 'samples/测试 样本/英文首列 变体.xlsx' --lang de --out "$target_dir/三层_de.png"
echo "两次命令已完成，请按 MAC自测.md 检查文字和报告中的 replacements。输出目录 $target_dir"
if [ -t 0 ]; then read -r -p '按回车结束'; fi
