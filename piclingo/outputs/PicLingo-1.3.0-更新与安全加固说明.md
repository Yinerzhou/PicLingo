# PicLingo 1.3.0 更新与安全加固说明

## 安装与功能

Windows 使用 `PicLingo-Setup-1.3.0.exe`，安装器已迁移到 NSIS，继续提供安装位置选择、桌面快捷方式和当前用户安装。从原 C# 安装器版本升级时读取旧安装位置，并迁移应用管理的文件。卸载依据文件清单删除应用文件，保留同目录个人文件和用户数据目录。

Windows 快捷方式继续使用原主进程的 `PicLingo.Desktop` AppUserModelID，保留原任务栏分组身份。新 NSIS 安装注册 GUID 独立固定，迁移后清理旧卸载注册项。

安装前检查目标目录及旧产品身份，拒绝写入未经产品清单确认的非空目录，并检查新文件与个人文件的同名冲突，沿用原安装器的文件保护行为。

Mac 按 Apple Silicon/Intel 选择对应 1.3.0 DMG，拖入 Applications。更新 ZIP、blockmap 和 latest-mac.yml 用于发布服务器。两种架构的更新元数据放在各自目录，避免覆盖。

图片翻译、OCR、离线语言包、译文校对和 PSD 出图入口保留。默认白色蒙层为 94%，原滑块范围和用户选择继续有效。原有 CSS、图标与图片处理算法保持文件内容。更新设置新增提供方、进度、更新日志和安装选择，使用现有组件。

## 八项审计问题的处理

| 项目 | 改了什么 | 为什么 |
|---|---|---|
| H01 更新发布者验证 | 接入 electron-updater 6.8.12，绑定随安装包提供的签名策略，安装前再次校验 SHA512。Windows 对 Authenticode 状态和发布者进行字面参数验证 | 防止更换文件和同源摘要后直接执行。缺少生产签名策略时明确停用自动安装 |
| H02 PSD 文件权限 | 主进程登记选择/真实拖入文件和输出目录，处理时重新核对真实路径。普通 PSD 请求拒绝 logs，日志导出走专用保存对话框与内部授权 | 防止绕过文件选择与日志保存对话框 |
| M01 请求边界 | 操作/字段白名单，路径、类型、语言、手动匹配及总量检查，最多 4 个 PSD 服务进程，8MB 请求上限。Excel 限制归档条目和解压体积 | 防止过量请求先耗尽主进程资源 |
| M02 更新生命周期 | 检查、下载、安装分开，安装前再次检查图片/PSD 任务，并阻止准备安装时启动新任务。错误写入轮转日志 | 后台下载和失败处理保持当前工作可用 |
| M03 构建依赖 | 将有公告的 minimatch 7～10 系列实例覆盖到 11.0.1，保留其他主版本，提交构建锁文件 | 修复受影响的构建依赖并保留调用兼容性 |
| M04 语言包来源 | 手动处理最多 5 次 HTTPS 同源重定向，限制大小，给已验证的中英归档补充 SHA256。其他条目保留结构检查并记录摘要缺失 | 加强来源与已知模型完整性，保留原语言包入口 |
| L01 正式调试面 | 正式启动关闭 DevTools，smoke 参数需开发环境或隔离验收标记 | 生产安装包收窄测试入口 |
| L02 依赖与版本锁定 | 应用及锁文件版本统一为 1.3.0，Windows/Mac 构建使用提交的 npm 锁与 npm ci | 固定可复现的依赖图 |

语言包索引共 100 项，其中 2 项具备本次已验证的归档摘要。其余 98 项继续使用 HTTPS 同源下载及归档结构验证，完整内容摘要仍取决于上游可核验数据。

## 修改文件与原因

| 文件或目录 | 修改目的 |
|---|---|
| `outputs/PicLingo-Liquid-Glass/electron/main.cjs` | 文件授权、受限 IPC、启动检查、更新生命周期和生产调试开关 |
| `electron/preload.cjs` | 真实拖入登记、受限更新操作、状态订阅及回调类型检查 |
| `electron/backend.cjs` | 校对数据类型及总量边界 |
| `index.html` | 仅增加功能性更新控件及沿用现有样式的更新弹窗 |
| `package.json`、`package-lock.json` | 固定生产更新依赖和版本 |
| `modules/psd-export/security.cjs` | 统一 PSD 请求与文件授权检查 |
| `modules/psd-export/electron.cjs`、`service.py` | 调度并发、内部日志授权、Excel 大小边界和更新日志导出 |
| `modules/psd-export/renderer/settings.js` | 更新源、状态、进度、纯文本日志与立即/延期安装 |
| `modules/psd-export/packaging/updates.cjs` | 定时检查、受控下载、签名、缓存复验、错误日志与延期状态 |
| `packaging/verify-signature.cjs`、`.ps1` | Windows 签名检查，路径和发布者使用编码参数，关闭 shell 拼接 |
| `packaging/build-nsis.cjs`、`after-pack.cjs`、`migration.nsh`、`Maintenance.cs` | NSIS 打包、旧安装迁移、清单卸载与用户文件保留 |
| `packaging/build-all-windows.ps1` | 从源码构建两个原生后端与 NSIS |
| `packaging/build-mac.py`、npm 构建配置/锁、`macos-release.yml` | 原生双架构构建、更新 ZIP/元数据、签名配置与云端验收 |
| `work/app/worker.py`、`work/assets/language-index.json` | 模型下载来源与摘要检查 |
| 新增或更新测试 | 覆盖 IPC 权限、特殊字符签名路径、更新状态及语言包下载 |

独立模块的桌面控制器、security、renderer、更新和签名脚本同步到现有 UI 的模块副本。原 `app.js`、`styles.css`、PSD 页面 CSS、图标和 `work/app/engine.py` 保持内容。

## 自动更新的使用

在设置中选择 GitHub Releases 或 HTTPS 地址，填写更新源。填写完成后点击“检查更新”会保存配置并立即检查。自动检查开启时，启动后延迟 30 秒首次检查，此后按 4 小时周期检查。

正式签名构建发现新版本后后台下载，在设置显示进度与纯文本更新日志。下载完成显示“重启更新”和“下次启动时更新”。

选择重启时，程序重新检查任务、缓存摘要和签名，再关闭后端并静默安装，完成后启动新版。存在图片/PSD 任务时提示先等待。

选择延期时继续使用当前会话。下一次启动检查会恢复延期版本、重新核对缓存与签名，再安装。网络不可用或当时已有处理任务时继续运行当前版本，延期记录保留到下次启动。正常会话中的后续定时检查会继续下载/显示状态，保留用户的延期选择。

更新检查、下载中断、摘要或签名失败均写入用户数据目录 `updates/update.log`，单日志超过 2MB 时轮转一份。导出诊断 ZIP 时包含更新日志。失败状态通过现有状态区显示。

## 更新源配置

GitHub 源填写 `owner/repo`，发布标签采用 `v1.3.1` 等稳定版本。当前客户端按匿名可访问的 Releases 检查，私有源码仓库可以配合单独公开发布仓库或受控的更新服务。客户端配置不放仓库管理 token。

HTTPS 源填写目录地址，例如 `https://updates.example.com/piclingo/stable/win-x64/`。该域名为文档示例，需替换成真实发布地址。建议分别使用 win-x64、mac-arm64、mac-x64 目录。地址接受 HTTPS，拒绝用户名/密码、查询参数和片段，后续重定向也须 HTTPS。

构建可通过 `PICLINGO_UPDATE_URL` 写入默认发布地址。运行时设置可切换 provider。下载位置变化后继续使用安装包内的签名策略校验发布者。

## Windows 构建、签名与发布

从源码包的 `piclingo` 目录运行，需要 Python 3.12、Node.js 22.12+、网络和 Windows .NET Framework 编译器。

```powershell
& modules/psd-export/packaging/build-all-windows.ps1
```

输出位于 `outputs/windows-1.3.0/`，包括 NSIS 安装包、`.exe.blockmap` 和 `latest.yml`。构建后将最终安装包和这些元数据一起归档。

签名构建设置 `WIN_CSC_LINK` 或 `CSC_LINK`、证书密码 `WIN_CSC_KEY_PASSWORD` 或 `CSC_KEY_PASSWORD`，并设置 `PICLINGO_PUBLISHER` 为证书中的发布者名称。可用 P12 路径/Base64 或按企业签名服务方式接入，私钥保存在受限环境。

未签名安装包通常可手动安装，可能显示 SmartScreen 或未知发布者提示，也可能被企业策略拦截。本次未签名构建的策略会明确拒绝自动下载/安装新版，保留更新检查与正常应用功能。正式签名构建才激活该安装链。

## Mac 云端构建、签名与公证

现有 GitHub Actions 在 macos-15 ARM64 和 macos-15-intel x64 原生 runner 分别构建。Windows 电脑可在 Actions 页面启动任务及下载产物，Mac 环境由 GitHub 提供。

当前开发分支为 `codex/piclingo-mac-1.2.0`，其中代码版本已更新为 1.3.0。推送该分支会自动构建。使用手动 Run workflow 之前，将代码及工作流提交或合并到默认分支 main，再选择目标分支运行。当前代码也可直接从交付的源代码 ZIP 构建。

自动推送构建生成 ad-hoc 签名的 DMG/ZIP、更新元数据和摘要。正式签名构建需要 Apple Developer Program 账号、Developer ID Application 证书及私钥。Mac 自动更新需要稳定的正式签名身份，面向客户的分发同时完成 Apple 公证。

在仓库 Actions Secrets 设置下列值，然后手动运行 Build PicLingo macOS，勾选 signed。

| Secret | 内容 |
|---|---|
| MAC_CERTIFICATE_P12_BASE64 | 含私钥的 Developer ID Application P12 Base64 |
| MAC_CERTIFICATE_PASSWORD | P12 密码 |
| APPLE_ID | 公证 Apple 账号 |
| APPLE_TEAM_ID | 团队 ID |
| APPLE_APP_SPECIFIC_PASSWORD | Apple 应用专用密码 |

构建脚本检查签名凭据，启用 hardened runtime，签名原生后端与应用，公证 app，再对最终 DMG 提交公证及装订。ZIP 包含正式签名的 app。签名与公证完成后计算最终摘要。

云端检查包括冻结 PSD 后端读取 Excel、原图片 UI 工作流、严格代码签名校验。正式分发物使用生产限制，另复制保持框架链接的隔离验收 app，加入测试标记并重签该副本进行工作流检查。

本次实际签名、公证及云端结果以同版验证报告为准。云端没有客户授权 Photoshop，PS2024 与 Mac Photoshop 的权限、客户字体和真实 PSD 仍需客户设备验收。

## 完整发版流程

1. 修改应用与构建包版本号，更新对应锁文件并提交，写明更新日志。
2. 运行 Python、Node、签名路径和下载安装边界测试，重新运行 UI、runtime、构建三份 npm audit。
3. 在 Windows 生成 NSIS，在双架构 Mac runner 生成 DMG/ZIP，检查签名、公证、版本和清单。
4. 校验图片翻译、语言包、校对、PSD、窗口和用户文件保留。用已安装的旧版执行更新验收。
5. 向测试 HTTPS 目录或受控测试发布仓库上传二进制、blockmap 和相应 latest 元数据。GitHub Draft Release 对普通客户端不可见。
6. 实测启动延迟、定时检查、进度、日志、延期、重启、断网、缓存损坏、错误摘要、错误签名和任务忙碌。
7. 验证通过后发布正式标签/Release，或先上传带版本号的 HTTPS 文件，再最后切换 latest.yml/latest-mac.yml。
8. 保存源代码提交、完整锁文件、产物 SHA256/SHA512、签名身份和验收报告。多架构 Mac 元数据分别发布到对应目录，单一 GitHub Release 的元数据需合并架构条目或采用验收通过的 Universal 包。

## 回退办法

客户端保持禁止自动降级。常规恢复使用上一版已验证业务代码重新构建更高版本，并使用同一发布身份发布，例如恢复正常代码后发布 1.3.2。

出现故障先暂停有问题的更新元数据/Release，停止后续客户端下载。已缓存待安装的版本需要单独处理，远端撤下无法保证取消所有客户端缓存。

紧急人工回退先停止处理任务，备份用户数据，然后用归档安装包恢复。Windows 原 1.2.0 的 C# 安装器与新 NSIS 身份不同，回退时先卸载 NSIS，确认个人文件保留，再安装原包到独立或已清理的应用目录。恢复相应版本的用户配置备份。保留图片、PSD 与导出目录。

Windows 数据目录为 `%APPDATA%\piclingo-system-glass`，Mac 为 `~/Library/Application Support/piclingo-system-glass`。更新缓存的真实位置写入更新日志。延期状态位于数据目录的 `updates/deferred.json`。

## 当前限制

本次签名凭据和正式发布地址尚未配置。Windows 包未商业签名，Mac 包使用 ad-hoc 且未 Apple 公证，自动安装会明确拒绝执行。配置正式签名并完成真实升级验收后可启用完整更新链。

语言包其余 98 项缺少上游可核验摘要。PS2024、Mac Photoshop、复杂富文本和实验性 RTL 仍按之前的客户样张验收要求执行。

## 可能出错的 5 个地方

1. 更新源元数据未上传、架构目录混用或缓存未刷新，导致查不到对应版本。
2. Windows 发布者名称、Mac Team ID、证书或公证凭据不匹配，更新校验会拒绝。
3. 网络中断、代理改写或存储服务不支持所需下载行为，触发更新错误日志。
4. Photoshop、图片任务或杀毒软件占用应用文件，影响安装或原生任务结束。
5. 从旧安装器迁移、人工降级或公司终端策略与样本环境不同，需要核对安装路径及用户文件保留。

