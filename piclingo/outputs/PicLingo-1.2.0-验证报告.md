# PicLingo 1.2.0 验证报告

验证日期为 2026 年 11 月 13 日。代码云端构建提交为 `38adf43a8b2e7361340a9a11a754c690cf995421`。

## 安装包与实际检查

| 交付 | 实际结果 |
|---|---|
| Windows x64 EXE | 最终安装包已生成，通过内嵌载荷校验、全新安装、1.1 升级、两个功能工作流与卸载保留用户文件 |
| Mac Apple Silicon DMG | macos-15 原生 ARM runner 构建成功，严格签名校验、冻结后端 Excel 读取与真实应用图片工作流通过 |
| Mac Intel DMG | macos-15-intel 原生 x64 runner 构建成功，严格签名校验、冻结后端 Excel 读取与真实应用图片工作流通过 |
| Mac Photoshop 出图 | 客户设备待验收，云端 runner 未安装授权 Photoshop |
| Photoshop 2024 25.x | 待客户环境验收，当前 Windows 实测为 Photoshop 2020 21.2.12 |

Mac 的启动与工作流检查使用隐藏窗口。云端透明效果关闭时选择兼容背景，客户桌面的 vibrancy 与窗口按钮观感仍需现场验收。Windows 本机也处于系统透明效果关闭状态，实际检查了兼容背景，系统设置保持用户原有选择。

构建任务、源码与草稿 PR 可在授权仓库查看。

- [云端双架构构建](https://github.com/Yinerzhou/PicLingo/actions/runs/43284627771)
- [代码提交](https://github.com/Yinerzhou/PicLingo/commit/38adf43a8b2e7361340a9a11a754c690cf995421)
- [草稿 PR](https://github.com/Yinerzhou/PicLingo/pull/1)

## Windows 实测环境

Windows 11 25H2，构建 26200，x64。Python 3.12.10，Electron 45.3.1，Photoshop 2020 21.2.12。PS 版本差异会写入日志，`photoshop.strict_version=true` 可要求主版本必须为 25。

## 测试结果

| 检查 | 结果与证据 |
|---|---|
| Python 单元测试 | 32 项通过，含 Excel/PSD 匹配后发生变化的拒绝检查。`modules/psd-export/release/unit-v1.2.log` |
| Node 平台、材质、对比度与更新测试 | 10 项通过。`release/node-tests.log` |
| Photoshop 基础实机测试 | 17 项通过。`tests/实机验收 20261113-021316/acceptance.json` 与 `release/legacy-psd-regression.log` |
| Photoshop 高级实机测试 | 8 项通过，最终源码再次运行。`release/acceptance-v12-20261113-025918/summary.json` |
| 最终 Windows 安装包 | 全新安装与 1.1 升级均通过原有图片 UI 与新增 PSD UI，卸载保留个人文件。`release/installer-qa-20261113-025701` |
| 模型来源与完整性 | 固定官方 Argos 地址下载、归档摘要与模型摘要核对通过。`release/models-probe.log` |
| 模块复制一致性 | UI 模块副本与独立模块的控制器、renderer、更新与检查入口逐文件一致 |
| 现有文件改动范围 | 基线中 8 个已有文件改变，原有 app.js、engine.py、worker.py 哈希保持一致 |
| 日志导出 | 真实生成 ZIP，包含 PSD 与图片 worker 日志。`release/logs-smoke/诊断 日志.zip` |
| 更新检查与校验逻辑 | 本地受控网络响应测试通过，正式远端发布源待配置 |

基础 17 项覆盖单层、三层、英文首列、中文表头、按 Key、隐藏跳过/包含、内嵌文字、缺字体跳过/失败、重复与空值/未匹配、损坏 PSD、版本拒绝、已有文档保护、状态恢复、真实忙碌超时和测试前后文档保护。

高级 8 项覆盖 PNG、JPG、可编辑 PSD、富文本字体字号颜色保持、点文字与段落文字缩小、手动匹配、多文件乘多语言并单项失败继续、日文字形覆盖与字体回退。

安装验收验证了实际界面导入、离线 OCR/翻译、译文编辑重绘、重复导出自动编号、50 项语言列表，以及 PSD 文件选择、Excel、匹配、德语出图、蒙层 94% 与原图片页状态恢复。测试通过隔离安装目录运行，系统注册和桌面快捷方式创建被测试参数关闭。默认安装程序保留桌面快捷方式选项。

## Mac 构建证据

两种架构使用 Python 3.11 和独立原生冻结后端，版本依赖固定。日志显示两者的 `codesign --verify --deep --strict` 通过，应用 `valid on disk`，满足其 Designated Requirement。

两种构建均在打包后启动真实应用，完成中文识别、中英离线翻译、界面译图解码、编辑重绘与两次无覆盖导出。另使用冻结 PSD 后端导入样本 XLSX，识别三种目标语言。结果、控制台及截图保存在对应 Actions artifact。

原生 Mac 构建成功证明后端和客户端在云端环境可以运行。Photoshop Apple Events 授权、PS25 文本描述符行为、客户字体、实际壁纸效果与客户原稿仍需 Mac 自测。交付的 Mac 脚本继续保留“待 Mac 实机验证”标记，以指明 Photoshop 验收状态。

## 签名与发布状态

- Windows 安装包当前无商业 Authenticode 签名，可能出现未知发布者或 SmartScreen 提示。
- Mac 应用使用 ad-hoc 签名，签名完整性检查通过。Developer ID 签名与 Apple 公证尚未执行，需要客户 Apple Developer 凭据。
- 自动更新代码支持公开 GitHub Releases 的版本发现、对应架构下载与 SHA256 检查。当前仓库为私有，正式更新源尚未配置和发布。
- 完整 Windows 源码构建脚本已提供，本次安装包由已有原生 OCR 后端和重新冻结的 PSD 后端增量构建。空目录端到端重建待另行执行。

## 已知限制与客户验收

1. 客户尚未提供实际 PSD、Excel、PS25 精确版本与 Mac 系统/芯片信息。当前样本为自制的可编辑文字 PSD。
2. 原有 OCR 语言能力保持原范围，来源为中英 OCR，其他目标译文依赖对应语言包。新增 PSD 译文由 Excel 提供。
3. 富文本样式按相对字符区间映射，跨语言的重点词位置需要人工复核。
4. 溢出检测属于几何检查。点文字以原始文字边界为参考，特殊变形及复杂排版需要设计师检查。
5. 内嵌 PSD/PSB 可递归处理，链接与其他格式智能对象写入未处理报告。
6. RTL 已加入实验性支持，阿拉伯语/希伯来语连字、混合标点、数字及客户字体待样张验收。
7. 已有用户模态对话框需要使用者处理，脚本运行时抑制可抑制提示。超时后 Photoshop 同步操作可能仍在执行，应检查恢复标记与结果。

## 旧功能回归清单

- [x] 旧 Python 引擎与 worker、原 app.js 原文保留。
- [x] 图片界面导入、OCR、中英离线翻译、译文显示。
- [x] 译文修改后重新生成图片。
- [x] 两次导出得到不同文件名。
- [x] 语言列表读取 50 项。
- [x] PSD 页面往返保留图片页状态。
- [x] Windows 全新安装与升级后上述双入口可用。
- [x] 卸载保留测试用户文件。
- [x] Mac 两架构原有图片工作流通过云端运行检查。
- [ ] 客户在不同壁纸下人工检查系统玻璃、拖拽和窗口按钮。
- [ ] 客户 PS2024 在 Mac 与 Windows 运行模板、复杂原稿及 RTL 样张。
- [ ] 正式证书、公证与真实更新源完成发布验收。

各阶段的运行步骤、验收清单和每阶段五项可能故障，见同版开发与发布说明。安装包摘要见各自同名 `.sha256.txt`。

