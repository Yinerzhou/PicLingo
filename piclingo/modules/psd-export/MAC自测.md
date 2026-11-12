# 【待 Mac 实机验证】10 分钟自测

## 前提

Mac 已安装 Photoshop 2024、Python 3.10+，当前桌面已登录。交付包内带最小 PSD、Excel 和 Python 通用依赖轮子。首次安装 Python、Photoshop 和公司权限审批需要另计时间。

所有 Mac 代码仍需实机验证。Windows 的 Python 虚拟环境无法复制到 Mac 使用，交付 ZIP 已排除该环境。

## 0～2 分钟，诊断

1. 解压到可读写目录，例如桌面的 `PicLingo PSD 阶段1`。
2. 在终端输入 `cd `，把解压后的 `psd-export` 文件夹拖入终端，再回车。
3. 运行 `bash diagnose-mac.command`。目标默认是 `/Applications/Adobe Photoshop 2024/Adobe Photoshop 2024.app`。
4. 首次出现自动化提示时，由使用者选择授权。
5. 查看生成的 `Mac诊断-日期时间.txt`，确认系统、架构、PS 版本、只读脚本调用结果。

应用位置不同时，诊断可使用下面的命令，并同步修改 `config.json` 的 `photoshop.mac_application`。

```bash
bash diagnose-mac.command '/实际位置/Adobe Photoshop 2024.app'
```

权限拒绝时，打开“系统设置 → 隐私与安全性 → 自动化”，在当前启动程序（通常为 Terminal）下允许 Adobe Photoshop。然后重新运行诊断。后续换为桌面客户端时，需要针对客户端重新验证权限。

若列表中没有该启动程序，先从该程序发起一次调用以触发授权提示，再查看设置。诊断通过表示当前进程的实际调用成功。

## 2～5 分钟，执行

```bash
bash selftest-mac.command
```

脚本会在当前模块创建独立 `.venv`，从本地 `dependencies` 安装固定版本依赖，先诊断，再依次生成单层和三层德语 PNG。终端窗口保留完整输出，副本位于 `tests/Mac自测-日期时间/selftest.txt`。

若要在 Finder 双击运行，可先执行以下命令赋予脚本运行权限。

```bash
chmod +x diagnose-mac.command selftest-mac.command
```

## 5～8 分钟，核对

- [ ] 单层 PNG 显示 `Sommeraktion`。
- [ ] 三层 PNG 显示 `Sommeraktion`、`Bis zu 50% sparen`、`Jetzt einkaufen`。
- [ ] 两张图均为 1200 × 800，背景与样本一致。
- [ ] 两次任务 `report.json` 的 `source_unchanged` 为 `true`。
- [ ] 两次任务的 `photoshop.replacements` 分别为 `1` 与 `3`。
- [ ] Photoshop 中此前打开的文档仍然存在，活动文档及对话框设置恢复。
- [ ] 文字路径含中文及空格时日志正常，输出可打开。

缺少 ArialMT 时，默认跳过文字并记录字体名。这会生成保留原文的图，必须按报告中的替换数量判断验收结果。

## 8～10 分钟，反馈

发送以下内容即可排查。

1. `Mac诊断-日期时间.txt`。
2. `tests/Mac自测-日期时间/` 的输出图及 `selftest.txt`。
3. `runs/` 中对应两次翻译任务的完整文件夹。
4. 下面的反馈表。

| 项目 | 填写 |
|---|---|
| macOS / 芯片 | |
| Photoshop 精确版本 | |
| 诊断是否通过 | |
| 单层替换数 / 三层替换数 | |
| 字体警告及其他错误 | |
| 原稿、已有文档、设置是否正常 | |

## 超时处理

看到 `-1712` 或 `RECOVERY_REQUIRED.json` 时，先检查 Photoshop 是否仍在运行任务、是否有对话框，等待任务结束。查看对应 `result.json` 与日志。确定已无运行中的脚本后，再按 README 的超时恢复步骤处理。

脚本会抑制运行期间可关闭的提示。执行前已存在的用户对话框需要使用者处理，否则会明确超时退出。
