#!/bin/bash
# 【待 Mac 实机验证】双击诊断，输出硬件、应用版本、实际 Apple Events 权限与脚本探测结果。
set -u
module_dir="$(cd "$(dirname "$0")" && pwd)"
report="$module_dir/Mac诊断-$(date +%Y%m%d-%H%M%S).txt"
{
    echo '【待 Mac 实机验证】PicLingo Photoshop 自动化诊断'
    date
    /usr/bin/sw_vers
    /usr/bin/uname -m
    /usr/sbin/sysctl -n machdep.cpu.brand_string 2>/dev/null || true
    echo 'Photoshop 安装信息'
    found=0
    while IFS= read -r -d '' app_path; do
        found=1
        echo "$app_path"
        /usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$app_path/Contents/Info.plist" 2>&1
    done < <(/usr/bin/find /Applications "$HOME/Applications" -maxdepth 3 -iname '*Photoshop*.app' -print0 2>/dev/null)
    if [ "$found" -eq 0 ]; then echo '未发现 Photoshop，请核对安装位置。'; fi
    echo '自动化权限与只读脚本调用测试'
    echo '若系统询问 Terminal 控制 Photoshop，请按公司授权选择。拒绝将记录 -1743。'
    app_target="${1:-/Applications/Adobe Photoshop 2024/Adobe Photoshop 2024.app}"
    if [ ! -d "$app_target" ]; then
        echo "目标应用不存在 $app_target"
        echo '请在终端运行 bash diagnose-mac.command /实际路径/Photoshop.app'
    else
        # 用只读脚本实际探测，避免将 TCC 数据库不可读误报为已授权。
        /usr/bin/osascript "$module_dir/adapters/macos.applescript" "$app_target" \
          '"PICLINGO_PROBE:" + app.version + ":documents=" + app.documents.length;' 15 0 1
        result=$?
        echo "调用退出码 $result"
        if [ "$result" -eq 0 ]; then
            echo '当前启动程序自动化权限及只读脚本调用通过。'
        else
            echo '请查看上方完整错误。-1743 为自动化权限拒绝，-1712 为忙碌/对话框/超时。'
            echo '权限设置位于 系统设置 → 隐私与安全性 → 自动化 → Terminal → Adobe Photoshop。'
        fi
    fi
    echo 'Python 环境（不影响上面的独立权限探测）'
    if [ -x "$module_dir/.venv/bin/python" ]; then
        "$module_dir/.venv/bin/python" --version
    elif command -v python3 >/dev/null 2>&1; then
        python3 --version
    else
        echo '未发现 Python 3；命令行出图需安装 Python 3.10 或更高版本。'
    fi
    echo '本诊断未修改 PSD、Photoshop 设置或系统权限。授权提示的选择由运行者决定。'
} > "$report" 2>&1
/bin/cat "$report"
echo "诊断文件 $report"
if [ -t 0 ]; then read -r -p '按回车结束'; fi
