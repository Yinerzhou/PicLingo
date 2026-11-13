# PSD 出图 · 1.3.0

1.3.0 完成桌面请求授权、日志保存边界、更新签名策略及 NSIS 迁移。当前安全、构建、发布与限制见项目 `outputs/PicLingo-1.3.0-更新与安全加固说明.md` 和同版验证报告。完整构建使用 `packaging/build-all-windows.ps1` 或 `packaging/build-mac.py`。

以下 1.2.0 与阶段 1 内容保留为历史说明。

## 当前版本

1.2.0 增加独立 PSD 桌面入口、文字层与 Excel 匹配、批量多语言导出、字体回退、溢出检查、PNG/JPG/PSD 和实验性 RTL。原有图片翻译引擎保持原文件与处理算法。

完整使用、构建、发布与验收状态参见项目 `outputs/` 下的 `PicLingo-1.2.0-使用说明.md`、`PicLingo-1.2.0-开发与发布.md` 和 `PicLingo-1.2.0-验证报告.md`。本目录 `阶段1-完整代码.md` 和 `阶段1-验证报告.md` 为阶段 1 交付记录。

Windows 实际 Photoshop 验证版本为 2020 21.2.12。PS 2024 及 Mac Photoshop 的精确兼容性需要客户设备验收。Mac 双架构构建与原有图片工作流的实际云端结果见当前验证报告。

桌面版用户配置位于用户数据目录的 `psd/config.json`，初始为 `{}`。页面设置优先，其他字段与本目录默认 `config.json` 合并。Mac 应用路径、语言别名、字体、超时及深度等均可配置。确认匹配后的 PSD 与 Excel 摘要在导出前再次校验。

发生超时或异常退出时，先检查 Photoshop、任务日志与 `runs/RECOVERY_REQUIRED.json`。确认 Photoshop 已结束脚本后，将恢复标记改名归档，再运行诊断。保留对应任务文件夹，方便排查。

## 阶段 1 历史交付记录

独立的命令行模块，输入一个 PSD、一份 XLSX、一个目标语言，输出原尺寸 PNG，使用本机 Photoshop 原生渲染。

本阶段新增文件全部位于 `modules/psd-export/`。现有应用源码、界面、样式及安装包保持原样。蒙层默认 94% 的改动安排在阶段 3。

Windows 实机环境为 Windows 11 25H2，系统构建 26200，已安装 Photoshop 2020 21.2.12。Photoshop 2024 25.x 尚待实测。Mac 适配、自测脚本和诊断均标注待实机验证。

## 文件结构

```text
psd-export/
├─ cli.py                       命令行、隔离任务、日志与超时
├─ excel_map.py                 Excel 识别与词条匹配
├─ config.json                  默认配置
├─ requirements.txt             固定依赖版本
├─ adapters/
│  ├─ windows.ps1               Windows COM 调用，UTF-8 BOM
│  └─ macos.applescript         【待 Mac 实机验证】Apple Events 调用
├─ photoshop/
│  └─ shared.jsx                共用 ES3 业务脚本，Mac 待实测
├─ diagnose-mac.command          【待 Mac 实机验证】独立诊断
├─ selftest-mac.command          【待 Mac 实机验证】最小链路自测
├─ MAC自测.md                    十分钟自测与反馈表
├─ samples/
│  ├─ make_excel.py             生成三种 Excel 模板
│  └─ 测试 样本/                一层/三层 PSD、Excel、已生成 PNG
├─ dependencies/                离线 Python 通用轮子
├─ tests/
│  ├─ test_core.py              Excel 与基础验证
│  ├─ windows_acceptance.py     Photoshop 实机验收
│  └─ legacy-baseline.json      旧源码哈希基线
├─ runs/                        每次任务独立日志与报告
├─ 阶段1-完整代码.md             文件结构及逐个文件的完整源码
└─ 阶段1-验证报告.md             实际验证结果与未验收项
```

## Windows 安装依赖

需要 Python 3.10+ 和已授权、可交互运行的 Photoshop。在 PowerShell 进入本模块目录后执行下列命令。本机开发环境已准备好 `.venv`，可直接使用。

```powershell
python -m venv .venv
& .\.venv\Scripts\python.exe -m pip install --no-index --find-links .\dependencies -r .\requirements.txt
& .\.venv\Scripts\python.exe .\cli.py --diagnose
```

没有安装 Photoshop 时，请通过 Adobe Creative Cloud 安装并登录 Photoshop 2024，先手动启动一次并完成首次运行设置，再执行诊断。只有其他 Photoshop 版本时，可先做兼容性预检，日志会记录版本差异。要将验收限定到 25.x，请设置 `photoshop.strict_version=true`。

多个版本并存时，默认 COM 注册可能指向其他版本。诊断会输出实际版本，可在配置中指定已注册的 `windows_progid`。单纯安装本模块无法提供 Photoshop 渲染能力。

## 一条命令出图

以下命令从本模块目录执行。`--out` 指向尚不存在的文件，父目录会自动创建。

```powershell
& .\.venv\Scripts\python.exe .\cli.py --psd '.\samples\测试 样本\最小 测试 1层.psd' --excel '.\samples\测试 样本\翻译 模板.xlsx' --lang de --out '.\results\最小 测试_de.png'
```

先核对单层，再执行三层。

```powershell
& .\.venv\Scripts\python.exe .\cli.py --psd '.\samples\测试 样本\多层 测试 3层.psd' --excel '.\samples\测试 样本\英文首列 变体.xlsx' --lang de --out '.\results\多层 测试_de.png'
```

## Mac 使用

【待 Mac 实机验证】阅读 `MAC自测.md`。调用层使用 `/usr/bin/osascript`，通过 AppleScript 向指定应用发送 JavaScript 文本，再用 `$.evalFile(File(...))` 加载同一份 ExtendScript。这样可避免混用 HFS 文件路径及 POSIX 文件别名。

```bash
python3 -m venv .venv
.venv/bin/python -m pip install --no-index --find-links dependencies -r requirements.txt
.venv/bin/python cli.py --psd 'samples/测试 样本/最小 测试 1层.psd' --excel 'samples/测试 样本/翻译 模板.xlsx' --lang de --out 'results/最小 测试_de.png'
```

## 制作测试文件

交付包已带可编辑 PSD 与对应 Excel。若需重新生成，请使用新目录避免覆盖。

```powershell
& .\.venv\Scripts\python.exe .\samples\make_excel.py --out-dir '.\samples\新 测试目录'
& .\.venv\Scripts\python.exe .\cli.py --make-fixture '.\samples\新 测试目录'
```

PSD 由 Photoshop 创建，分别含一个和三个英文文字图层，图层名为 `headline`、`discount`、`button`。尺寸 1200 × 800，默认 ArialMT，未安装时使用 Photoshop 可用字体。Excel 与文字内容一一对应。

手工制作时，也可新建 RGB 文档，添加上述图层，文字分别填写 `Summer Sale`、`Save up to 50%`、`Shop Now`，保存为可编辑 PSD。样本目录和文件名含中文及空格，适合路径验证。

## Excel 自动识别规则

1. 表头默认在第 1 行，可配置 `header_row`。只有一个工作表时自动选用，多个工作表必须配置 `worksheet`，避免选择歧义。
2. 语言表头去除首尾空格、忽略大小写、将下划线归一化为连字符，按 `language_aliases` 识别。`en / EN / English / 英文` 均映射到 `en`。
3. 未配置的表头仅在符合两字母语言码或带地区代码时被当作语言列，例如 `it`、`pt-BR`。备注等列忽略。
4. `Key`、`图层名` 等表头按 `key_headers` 识别。`原文`、`英文原文` 等按 `source_headers` 识别，否则使用识别为源语言的列。
5. 无 Key、无已知原文列时，将未知首列作为原文并警告。首列已识别为其他语言时拒绝推断。
6. 多列映射到同一种语言、同时存在原文列和源语言列时明确报错。
7. 默认按英文原文匹配，去除首尾空格、统一换行、区分大小写。可切换 `match_by=key`，图层名对应 Key。
8. 重复 Key 或重复原文默认保留第一条并警告。重复判断使用相同的文本归一化规则。
9. 空译文保留原文并警告。无匹配图层保留原文并写入报告。Excel 公式和错误值要求先粘贴为纯文本。

`run.jsonl` 会记录表名、原始表头、语言与列号映射、匹配方式、重复及空值警告、每个匹配行号和替换文案。

## 配置选项与默认值

编辑 `config.json` 或复制后通过 `--config 文件路径` 使用。未知枚举或阶段 1 尚未实现的执行选项会明确报错。

| 配置项 | 默认值 | 本阶段行为 |
|---|---|---|
| hidden_layers | skip | 隐藏图层及隐藏组内文字跳过，可设 include |
| smart_objects.embedded | process | 处理内嵌 PSD/PSB 的文字，可设 skip |
| smart_objects.linked | report | 链接对象保留并记录未处理 |
| smart_objects.max_depth | 5 | 超限保留对象并报告 |
| duplicates | first_warn | 第一条有效词条优先，可设 error |
| empty_translation | keep_warn | 保留原文，可设 error |
| unmatched | keep_report | 保留原文，可设 error |
| missing_font | skip_report | 输出缺失字体 PostScript 名并跳过，可设 error |
| output.format | png | 当前仅实现 PNG，JPG/PSD 在阶段 2 |
| output.size | original | 保持原尺寸 |
| output.color_profile | sRGB IEC61966-2.1 | 在渲染副本转换颜色，输出 RGB/8 位 |
| output.jpg_quality | 90 | 已预留，阶段 2 的 JPG 导出使用 |
| output.overwrite | false | 禁止覆盖已存在的输出 |
| overflow.strategy | warn | 已预留，可靠检测与标红在阶段 2 |
| overflow.minimum_font_size | 8 | 已预留，阶段 2 使用 |
| font_fallbacks | 空映射 | 已预留，阶段 2 使用 |
| rtl_enabled | false | 当前阶段拒绝 RTL 出图，等待需求确认 |
| language_aliases / language_names | 配置内映射 | 可扩展代码、表头别名及语言中文名 |
| photoshop.expected_major | 25 | 记录版本差异 |
| photoshop.strict_version | false | 可设 true，仅允许目标主版本 |
| photoshop.busy_retries | 3 | 最多初次调用加 3 次重试 |
| photoshop.retry_delay_seconds | 2 | 忙碌重试间隔 |
| photoshop.probe_timeout_seconds | 30 | 单次探测的调用进程总期限 |
| photoshop.task_timeout_seconds | 180 | 任务调用进程总期限 |
| photoshop.suppress_dialogs | true | 临时 DialogModes.NO，结束恢复 |

尚未接入的配置会在任务报告 `stage2_pending` 中列出。阶段 1 不自动改变字号或替换字体。多样式混排文字会保留原文并标记 `rich_text_pending_stage2`，需要阶段 2 的专门处理及样本验收。

## Photoshop 2024 兼容处理

- 业务脚本使用 ES3 语法与自带 JSON 序列化，避免依赖 ExtendScript 缺少的现代 Node API。
- 使用原生 `app.open`、`Document.duplicate`、`PNGSaveOptions`。当前未调用 UXP，无 UXP 插件权限、文件 token 或 `executeAsModal` 小版本依赖。
- Windows 通过独立 STA PowerShell 进程访问 COM，脚本文件采用 UTF-8 BOM，避免 Windows PowerShell 5.1 将中文解码为本地 ANSI。
- 路径通过参数数组及 JSON 字符串字面量传递，避免中文、空格、引号被解释为命令。
- Mac 通过指定应用路径解析 Photoshop AppleScript 字典，传入 JavaScript 文本，由共享脚本处理文件路径。
- 使用 `DialogModes.NO` 抑制可抑制提示，在任务结束恢复之前的设置。输入在内存副本修改，颜色转换只作用于渲染副本。
- 原生 PNG 导出后校验 CRC 和尺寸。对于已经转为标准 sRGB、但保存时未包含 ICC/sRGB 块的 PNG，补写标准 sRGB 颜色块，保持像素压缩数据原样。
- 字体按图层的 `textStyleRange` / `fontPostScriptName` / `fontAvailable` 检查，并结合 Photoshop 字体列表核对。
- 内嵌对象先建立独立内容副本，仅对本任务新打开的内嵌文档保存更改。非 PSD/PSB 对象及无法判断类型的对象保留并报告。

以上为针对 25.x 的实现策略。本机运行证据来自 21.2.12，25.x API 及字体/智能对象行为需要使用客户的精确版本验收。

## 对话框、忙碌与超时

Windows 仅对明确表示调用未获准执行的 `80010001`、`8001010A` 做有限重试。Mac 仅对明确未处理的 `-1708` 做有限重试。脚本任务自带启动标记，防止同一任务被重复执行。

运行前的只读探测用于检测脚本入口是否可用。任务开始后临时禁用可抑制提示，包括字体缺失和颜色配置提示，并记录设置。执行前已有的用户模态窗口可能阻止脚本进入，此时提示关闭窗口或等待 Photoshop 空闲。预先存在的用户确认框需要用户选择，脚本无法在被阻塞时自行执行设置。

超时或调用中断时只终止桥接进程。Photoshop 内部的同步操作可能仍在继续，因此保留 `runs/RECOVERY_REQUIRED.json`，阻止下一次任务进入。

恢复步骤如下。

1. 查看该文件中的任务目录及相关日志。
2. 检查 Photoshop，等待正在执行的脚本结束，处理现有对话框。
3. 检查 `result.json`、活动文档及对话框设置。若结果缺失，关闭带 `PicLingo-` 名称且确认由本次任务生成的副本，选择不保存。若 Photoshop 完全无响应，先处理用户工作，再由使用者决定是否重启。
4. 确认已无脚本执行后，将 `RECOVERY_REQUIRED.json` 改名为归档文件，例如 `RECOVERY_ACK-日期.json`，再启动新任务。

所有内部临时文档正常结束时都会关闭，已有用户文档保留，原活动文档恢复。输入已打开且存在未保存修改时，明确失败，要求先保存或关闭后再试。

## 日志及报告

每次任务会打印自己的 `runs/日期-随机编号/` 路径。

- `run.jsonl` 包含 Python、桥接和 Photoshop 的合并日志与各步骤耗时。
- `photoshop.jsonl` 包含 Photoshop 内逐图层匹配、替换和错误。
- `transport.jsonl` 包含 COM 的版本、重试、HRESULT 和完整异常。
- `bridge-output.txt` / `probe-output.txt` 保存原始调用输出，含 Mac AppleEvent 错误。
- `result.json` 包含 Photoshop 侧成功状态、图层结果和清理状态。
- `report.json` 包含最终输出、原稿校验、匹配及未处理项目。
- `failure.json` 包含失败步骤、完整 Python 堆栈与错误信息。

Mac 权限 `-1743` 会提供授权入口，`-1712` 会提示超时与仍在执行的可能。日志包含图片文字及路径，向外发送前请确认内容可分享。

## 运行测试

```powershell
& .\.venv\Scripts\python.exe -m unittest discover -s .\tests -v
& .\.venv\Scripts\python.exe .\tests\windows_acceptance.py
```

实机验收使用本模块自有样本，需要 Photoshop 可用，耗时约两分钟。结果位于 `tests/实机验收 日期时间/acceptance.json`，每个案例保留 CLI 完整日志及任务报告。

## 阶段 1 验收清单

- [ ] 单层先通过，三层随后通过，替换数分别为 1 和 3。
- [ ] 输出为 1200 × 800 PNG，德语文案可见，sRGB 输出配置已记录。
- [ ] 中文、空格路径通过。
- [ ] Excel 模板及英文首列、中文表头变体通过。
- [ ] 重复、空译文、未匹配、隐藏、缺字体行为符合配置。
- [ ] 错误能定位步骤，包含完整异常、可能原因及耗时。
- [ ] 原稿哈希一致，已有文档、活动文档及临时设置恢复。
- [ ] PS 2024 的客户精确版本完成实测。
- [ ] Mac 自测及诊断由实际设计师完成并反馈。

## 可能出错的 5 个地方

1. COM 注册仍指向旧 Photoshop，或 Photoshop 与调用程序权限级别不同。
2. Photoshop 存在模态窗口、其他自动化或长时间同步操作，触发忙碌及超时。
3. 实际 Excel 有多个表、公式、歧义表头或重复词条，导致拒绝或按首条处理。
4. 客户字体、混合样式、外部格式智能对象与当前样本不同，需要补充验证。
5. Mac 应用路径、自动化授权或精确 25.x 行为不同，当前尚无实机证据。

## 旧功能回归检查清单

- [ ] 核对旧源码哈希与 `tests/legacy-baseline.json` 一致。
- [ ] 图片/文件夹/拖入导入及原有批量行为。
- [ ] OCR、中英离线翻译及语言包管理。
- [ ] 译文编辑、重新渲染、原译对比及导出。
- [ ] 单项失败后续处理及停止操作。
- [ ] 现有窗口按钮、系统材质、降级及蒙层手动调整。

阶段 1 的旧源码一致性会实际检查。旧 UI 的人工操作回归与 Mac 图片翻译回归仍需后续执行。模块不会在本阶段接入现有客户端，进入阶段 2 前等待确认。

