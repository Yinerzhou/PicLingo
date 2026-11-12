# PicLingo 1.2.0 开发与发布

## 代码结构与模块边界

```text
piclingo/
├─ modules/psd-export/
│  ├─ cli.py、excel_map.py、config.json    命令行、Excel 与默认配置
│  ├─ service.py、fonts.py                批量调度、字体覆盖检查
│  ├─ electron.cjs                       独立桌面进程控制器
│  ├─ adapters/                          Windows COM 与 Mac Apple Events
│  ├─ photoshop/shared.jsx               共用 Photoshop ES3 脚本
│  ├─ renderer/                          PSD 页面与设置接入
│  ├─ packaging/                         Windows/Mac 构建、更新、签名配置
│  ├─ samples/                           可编辑 PSD 与 Excel 样本
│  ├─ tests/                             单元、平台、Photoshop、安装验收
│  ├─ diagnose-mac.command               Mac 一键诊断
│  └─ selftest-mac.command、MAC自测.md     Mac Photoshop 十分钟验收
├─ outputs/PicLingo-Liquid-Glass/         现有 Electron 客户端
├─ work/app/engine.py、worker.py          原有 OCR/翻译引擎
├─ work/PicLingoWorker.spec               原有引擎打包规格
└─ .github/workflows/piclingo-macos.yml   双架构 Mac 云端构建
```

PSD 模式从 Excel 读取译文，使用独立的进程、任务目录与 Photoshop 锁。图片翻译入口继续调用原有 Python 引擎。PSD 输出失败会写入报告，随后继续下一项。

完整代码文档先给出文件树，再按文件列出完整文本。图标、PSD、XLSX 与本地依赖轮子收录于源代码包，源代码包包含逐文件 SHA256 清单。大体积 OCR 模型由构建脚本按固定地址下载并核对摘要。

## 可复现构建

以下命令在解压后的 `piclingo` 根目录执行。安装依赖与下载 Electron、模型需要网络。Windows 使用 Python 3.12、Node.js 22 及系统 .NET Framework 编译器。Mac 使用目标架构的 Python 3.11、Node.js 22、Xcode Command Line Tools。

### Windows

```powershell
& .\modules\psd-export\packaging\build-all-windows.ps1
```

该脚本安装依赖，获取并校验中英模型，分别冻结 OCR 与 PSD 后端，复制 Electron 与原有图标，编译安装包。已有构建目录先在同一工作区改名备份。完整从空目录重建的脚本与本次增量构建证据分别记录，实际测试结果以验证报告为准。

输出为 `outputs/PicLingo-Setup-1.2.0.exe`。打包前将独立模块的 `electron.cjs`、`renderer/`、`packaging/updates.cjs` 和 `packaging/smoke.cjs` 同步到 UI 目录中的 `modules/psd-export/`。源码交付包已同步。

### macOS

```bash
python3.11 modules/psd-export/packaging/build-mac.py --arch arm64
python3.11 modules/psd-export/packaging/build-mac.py --arch x64
```

每条命令分别在对应架构的 Mac 执行。脚本检查 Python 与机器架构，构建两个原生后端，读取样本 Excel，生成 DMG，严格校验应用签名，运行原有图片翻译界面检查，再写出 SHA256。输出目录为 `outputs/mac-arm64` 与 `outputs/mac-x64`，最低系统配置为 macOS 13。

GitHub 源码放在 `piclingo/` 子目录，工作流会自动进入该目录。分支 `codex/piclingo-mac-*` 的推送触发双架构原生构建。工作流也可在 Actions 中手动执行。构建结果与诊断日志保存在 Actions artifacts，需有私有仓库访问权限。

## 阶段 2 核心功能

读取文字树、分组、隐藏状态、字体、字号、组路径与内嵌 PSD/PSB。链接及其他格式智能对象记录为未处理。三种匹配方式均使用同一匹配函数。替换使用 Photoshop 原生文字描述符，富文本样式按相对字符区间映射。

按语言检查字体字形，尝试本机已安装的备用字体。导出支持 PNG/JPG/PSD、命名规则、重名自动编号、原稿哈希校验和每项独立失败报告。默认仅预警溢出，可选择自动缩小及字号下限。RTL 需要显式开启，并在报告中标记为实验性。

### 运行与测试

```powershell
& modules/psd-export/.venv/Scripts/python.exe -X utf8 -m unittest discover -s modules/psd-export/tests -v
& modules/psd-export/.venv/Scripts/python.exe -X utf8 modules/psd-export/tests/windows_acceptance.py
& modules/psd-export/.venv/Scripts/python.exe -X utf8 modules/psd-export/tests/acceptance_v12.py
```

后两条需要 Photoshop。最小 CLI 验证命令如下，输出路径应尚不存在。

```powershell
& modules/psd-export/.venv/Scripts/python.exe modules/psd-export/cli.py --psd 'modules/psd-export/samples/测试 样本/最小 测试 1层.psd' --excel 'modules/psd-export/samples/测试 样本/翻译 模板.xlsx' --lang de --out 'modules/psd-export/results/最小 测试_de.png'
```

### 验收清单

- [ ] 单层输出 Sommeraktion，三层输出三条德语，原始尺寸为 1200 × 800。
- [ ] 三种匹配方式、表头别名、隐藏层策略、内嵌对象符合配置。
- [ ] 空值、重复词条、缺字体与未匹配项产生报告。
- [ ] PNG/JPG/PSD、富文本、缩小字号及日文字体回退符合样本结果。
- [ ] 多文件乘多语言中单项失败继续，原稿哈希、用户文档及设置恢复。
- [ ] 确认匹配后修改 PSD 或 Excel，重新读取或明确拒绝旧匹配。

### 可能出错的 5 个地方

1. COM 注册指向其他 PS 版本，或 Mac 应用路径与安装位置不同。
2. 已有模态窗口、脚本忙碌或超时，需先检查 Photoshop。
3. 表头歧义、公式单元格与重复词条造成预期外匹配。
4. 字体文件覆盖信息不足、原稿字体缺失或目标字体未安装。
5. 富文本、智能对象变换、RTL 或特殊字体排版需要客户样本核对。

### 改动、限制与旧功能回归

阶段 2 的业务实现均在独立模块。原有 OCR/翻译代码保持原文件及算法。富文本按字符比例映射重点样式，点文字以原始边界作为可用区域，段落文字使用扩展副本测量。复杂变形、极长译文及非 PSD/PSB 智能对象需人工检查。已存在的用户模态对话框由使用者关闭，运行期间用 `DialogModes.NO` 抑制可抑制提示。

- [ ] 图片导入、识别、离线翻译、编辑重绘与导出正常。
- [ ] 语言包列表与原有下载入口正常。
- [ ] 原图片任务状态、原译对比与错误提示保持可用。

## 阶段 3 页面接入

侧边栏增加 PSD 出图入口。页面按选择 PSD、导入 Excel、确认匹配、输出设置、开始导出排列，复用原有玻璃组件。原页面 DOM 保留，切回时恢复原图片工作状态。

白色蒙层默认与初始化值设为 94%，保留 70%～94% 范围和用户已保存的选择。原样式表的语义改动为默认蒙层变量。新模块的样式放在独立 `renderer/page.css`，错误与溢出使用可读的深红提示。

### 已修改的 8 个现有文件

| 文件（相对 UI 目录） | 原因 |
|---|---|
| index.html | PSD 入口、设置接入、默认 94% 及三处经用户批准的功能性文案 |
| styles.css | 默认蒙层 .74 改为 .94 |
| desktop-bridge.js | 默认值及初始化，继续读取用户手动选择 |
| package.json | 产品版本 1.2.0 |
| electron/main.cjs | 独立 PSD IPC、更新与日志入口、Mac 资源路径、验收入口和生命周期 |
| electron/preload.cjs | 限定的 PSD、更新、日志及平台能力 |
| electron/backend.cjs | Mac 用户数据路径和可选子进程环境 |
| electron/material.cjs | Mac 原生左侧按钮与 vibrancy，Windows 自绘按钮继续使用 |

`app.js`、`work/app/engine.py` 与 `work/app/worker.py` 保持原文。三处批准文案现为“本地处理”“本地文件”“当前用户”。

### 测试与验收

```powershell
node --test modules/psd-export/tests/platform.test.cjs modules/psd-export/tests/updates.test.cjs outputs/PicLingo-Liquid-Glass/tests/material.test.cjs outputs/PicLingo-Liquid-Glass/tests/contrast.test.cjs
```

- [ ] 默认蒙层 94%，滑块范围与手动记忆正常。
- [ ] PSD 选择、拖入、工作表、手动匹配、进度、失败列表和目录入口正常。
- [ ] 日志 ZIP 同时包含图片与 PSD 日志。
- [ ] Mac 左侧原生按钮，Windows 右侧自绘按钮和拖拽区域正常。
- [ ] Mac vibrancy，Windows 透明效果关闭时正确降级。

### 可能出错的 5 个地方

1. preload、独立模块与原生后端打包版本不同步。
2. 权限受限或网络盘路径导致拖入、读取和导出失败。
3. 手动匹配后源文件被其他程序修改，需要重新确认。
4. 本地存储已有蒙层选择，启动后按用户选择恢复。
5. 系统透明效果、辅助功能或远程会话影响材质，需确认降级背景。

### 已知限制与旧功能回归

材质和标题栏跨系统的视觉验收仍需真实客户桌面。深色、浅色、花哨壁纸使用同一白色蒙层与半透明面板保障深色文字，94% 默认值优先保证可读性。自动对比度测试覆盖滑块两端及壁纸明暗极值，人工桌面观感见验证报告。

- [ ] 图片页导入与处理状态在进入/离开 PSD 页面后保留。
- [ ] 离线语言包与设置原入口可用。
- [ ] 图片导入、OCR、翻译、编辑、重绘和重复导出无覆盖。

## 阶段 4 安装与发布

Windows 安装器沿用原身份与原图标，提供桌面快捷方式，覆盖升级时保留用户文件。隔离安装验收刻意关闭系统注册和桌面快捷方式，以免更改开发者桌面。默认安装交互保留该选项。

```powershell
& modules/psd-export/packaging/test-installer.ps1
```

检查安装包内嵌载荷、全新安装、1.1 升级、两个真实界面工作流，以及卸载后用户文件保留。

### Mac Developer ID 签名与公证

需要有效的 Apple Developer Program 账号、对应 Team ID 和 Developer ID Application 证书及其私钥。本次证书与凭据的实际使用状态见验证报告。

1. 在开发者账号创建 Developer ID Application 证书，在钥匙串中连同私钥导出为带密码的 P12。
2. 将 P12 转为单行 Base64，保存到仓库 Actions secret `MAC_CERTIFICATE_P12_BASE64`。密码保存到 `MAC_CERTIFICATE_PASSWORD`。
3. 设置 `APPLE_ID`、`APPLE_TEAM_ID`、`APPLE_APP_SPECIFIC_PASSWORD`，应用专用密码从 Apple 账号安全设置生成。仅将这些值放入仓库 Secrets。
4. Actions 选择本次代码分支，手动执行 Build PicLingo macOS，勾选 signed。
5. 构建自动加载 P12，启用 hardened runtime，读取规范化的 entitlements，声明 Photoshop 自动化用途，并对原生后端签名。
6. electron-builder 公证 app。随后严格验证签名与 Gatekeeper，再对最终 DMG 执行 notarytool submit、staple 和 validate。
7. 下载最终 DMG 及其 SHA256，在另一台 Mac 安装并测试自动化权限、原有翻译与 PSD 出图。

本地签名构建可通过同名环境变量执行 `python3.11 modules/psd-export/packaging/build-mac.py --arch arm64 --signed`，Intel 使用 `--arch x64`。本地 `CSC_LINK` 可以为 P12 的绝对路径或 Base64。失败日志避免直接回显包含公证密码的命令。

缺少开发者证书时构建使用本机 ad-hoc 签名，系统可能阻止首次打开。确认来源与校验值后，可在“系统设置 → 隐私与安全性”中使用系统允许的打开入口。企业策略限制由管理员处理。

### Windows 代码签名

需要受信任 CA 颁发的 Authenticode 证书及 Windows SDK 的 SignTool。企业证书或托管签名服务按其提供商方式使用。若证书安装在用户证书库，签名示例如下。

```powershell
signtool sign /sha1 YOUR_CERTIFICATE_THUMBPRINT /fd SHA256 /tr https://timestamp.digicert.com /td SHA256 outputs/PicLingo-Setup-1.2.0.exe
signtool verify /pa /v outputs/PicLingo-Setup-1.2.0.exe
```

发布前应先签客户端与卸载程序，重新生成载荷和安装包，再签最终安装包。签名完成后重新计算最终 SHA256。证书和信誉积累会影响 SmartScreen 提示，当前交付签名状态见验证报告。

### 更新方案

客户端支持配置可匿名访问的 GitHub Releases 仓库，启动时检查稳定语义版本，按系统及架构选择安装包，下载后核对同名 `.sha256.txt`，然后打开安装器。

Release 同时上传以下文件。

```text
PicLingo-Setup-1.2.0.exe
PicLingo-Setup-1.2.0.exe.sha256.txt
PicLingo-1.2.0-arm64.dmg
PicLingo-1.2.0-arm64.dmg.sha256.txt
PicLingo-1.2.0-x64.dmg
PicLingo-1.2.0-x64.dmg.sha256.txt
```

标签采用 `v1.2.0`。发布完成后在设置填写 `owner/repo`，启用自动检查。当前源代码仓库为私有，客户端匿名读取私有 Releases 会失败。发布源尚需实际配置，交付报告明确记录状态。程序按用户点击执行下载与安装。

### 日志与配置

Windows 用户数据通常为 `%APPDATA%\piclingo-system-glass`，Mac 为 `~/Library/Application Support/piclingo-system-glass`。PSD 的 `jobs/`、`runs/`、字体索引、`config.json` 位于其中的 `psd/`。图片处理错误日志为用户数据根目录的 `worker.log`。更新配置与下载位于根目录的 `updates/`。

PSD 的用户 `config.json` 初始为 `{}`，按请求与模块默认值合并。页面明确设置的项优先，语言别名、表头名称、源语言、字体路径、智能对象深度和 PS 超时等可在该文件配置。无效配置会明确报错。完整默认字段见模块 `config.json`。

“设置 → 导出日志”或 PSD 页面的“导出日志”生成可分享的 ZIP。日志包含路径、图层文字与译文，发送给排障人员前按公司要求检查内容。

超时恢复需先确认 Photoshop 已结束调用，检查对应任务结果与原稿状态。确认无任务运行后，将 `psd/runs/RECOVERY_REQUIRED.json` 改名归档，再运行诊断。超时后避免直接重复发送脚本。任务会尽量恢复活动文档、对话框及单位设置，并保留失败日志。

### 验收清单

- [ ] 载荷校验、全新安装、升级、双入口工作流、卸载保留用户文件通过。
- [ ] ARM 与 Intel 分别在原生 Mac runner 构建并完成真实 OCR/翻译检查。
- [ ] Mac 客户端在客户 PS 2024 上完成单层、三层、字体、权限与导出验收。
- [ ] 证书签名、公证状态与安装包 SHA256 对应。
- [ ] 配置正式更新源后验证新版本发现、下载、校验及安装。

### 可能出错的 5 个地方

1. 原生依赖缺少相应架构轮子，构建需使用锁定版本与目标架构 Python。
2. Apple 证书、私钥、密码或 Team ID 不匹配，导致签名或公证失败。
3. SmartScreen、Gatekeeper 或公司终端策略阻止首次安装。
4. 更新源为私有、缺少对应架构附件或校验文件，更新检查失败。
5. 安装目录受保护、旧进程占用文件或磁盘空间不足导致升级失败。

### 已知限制与旧功能回归

PS 2024、Mac Photoshop、复杂客户模板及 RTL 的最终验收依赖客户环境。打包与模拟样本验证覆盖范围见独立验证报告。

- [ ] 安装后中英离线图片翻译、编辑重绘与导出正常。
- [ ] 原有模型列表可读，语言包入口正常。
- [ ] 旧安装升级保留个人文件，卸载仅移除应用管理的文件。
- [ ] 窗口操作、默认蒙层与导航状态正常。

