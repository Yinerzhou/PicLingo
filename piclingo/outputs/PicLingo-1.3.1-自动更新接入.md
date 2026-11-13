# PicLingo 1.3.1 自动更新接入

## 客户端流程

应用启动 30 秒后检查更新，此后每 4 小时检查。发现较新版本后后台下载，下载完成显示更新日志，可选择“重启更新”或“下次启动时更新”。图片或 PSD 任务运行期间拒绝安装。网络和校验失败写入日志，业务功能继续运行。

1.3.1 内置目标发布仓库 `Yinerzhou/PicLingo-Releases`。新用户使用内置地址。旧设置中的空地址自动采用内置地址，保留用户关闭自动检查的选择及用户填写的有效自定义地址。

当前公开发布仓库尚未访问成功，线上发布和跨版本在线安装仍待验证。这个文件与本地安装包的存在均不能证明线上更新已上线。原 1.1.0 客户端需要一次引导升级，才能获得本次更新能力。

## 本次改动与原因

| 文件 | 改动与原因 |
| --- | --- |
| `modules/psd-export/packaging/updates.cjs` 及 UI 同步副本 | 加载构建内置地址，迁移空更新设置。加入 Windows 发布签名验证，保留后台下载、任务保护、摘要复验和原有正式证书验证 |
| `release-signature.cjs` 及 UI 同步副本 | 使用 Node 原生密码库校验 Ed25519 签名，绑定版本、平台、架构和 SHA512 摘要 |
| `release-channel.json`、`update-public-key.pem` | 保存目标发布仓库及可信公钥，客户端无需仓库令牌 |
| `after-pack.cjs` | 将内置源和公钥写入应用资源中的发行策略 |
| `sign-release.cjs` | 发布前检查真实安装文件摘要和大小，再签名更新清单 |
| `build-nsis.cjs`、`build-mac.py` | 构建更新源改用发行配置，支持环境变量覆盖 HTTPS 地址 |
| `build-all-windows.ps1` | 同步新增签名验证模块，确保完整构建可复现 |
| `windows-release.yml` | 提供云端构建、签名更新元数据、上传草稿及发布流程，禁止覆盖已有版本 |
| UI 与构建目录的 `package.json`、`package-lock.json` | 版本统一为 1.3.1，依赖版本保持原值 |
| `release-notes.md` | 记录本次用户可见改动 |
| `tests/release-signature.test.cjs` | 检查签名、缓存篡改、默认源迁移和发布工具 |

界面 HTML、CSS、图标、图片翻译代码与 PSD 业务代码没有修改。

## 发布前的一次性设置

1. 创建公开二进制发布仓库 `Yinerzhou/PicLingo-Releases`，确认匿名用户可访问。
2. 将 `windows-release.yml` 放入源码仓库默认分支的 `.github/workflows/piclingo-windows-release.yml`。源码位于 `piclingo/` 子目录和位于仓库根目录均支持。
3. 在私有源码仓库的 Settings → Secrets and variables → Actions 中设置 `PICLINGO_RELEASE_TOKEN`。使用仅授权公开发布仓库、具有 Contents 读写权限的细粒度令牌。令牌只用于构建服务器向该仓库上传发行文件。
4. 添加 `PICLINGO_UPDATE_PRIVATE_KEY`。本次私钥保存在 `%LOCALAPPDATA%\PicLingoReleaseKeys\update-ed25519.pem`，仅将其内容填入 GitHub Secret。该私钥需要安全备份，客户端只包含配对公钥。私钥和令牌均不得提交到源码、公开仓库或聊天。
5. 若使用 Windows 商业签名证书，再配置 `WIN_CSC_LINK`、`WIN_CSC_KEY_PASSWORD` 和变量 `PICLINGO_PUBLISHER`。保留相同发行者身份。

Windows 使用发布签名校验即可验证本工具发布的更新载荷。未配置商业证书时，安装包仍可能触发 SmartScreen 或企业安全软件提示，发布签名无法替代系统证书信誉。

macOS 自动安装仍需要稳定的 Developer ID 签名身份与公证。原有 Mac workflow 和签名配置继续适用，尚未提供 Apple Developer 凭据时不能承诺正式自动安装可用。

## 每次发版

1. 增加应用版本号，同步锁文件根包版本，更新 `release-notes.md`。
2. 提交源码，确保自动测试通过。
3. 推送 `piclingo-v版本号` 标签，或在 Actions 运行 Release PicLingo Windows。
4. CI 检查发布仓库可公开下载、私钥与内置公钥一致、标签与应用版本一致，然后构建并测试。
5. CI 为 `latest.yml` 中的文件签名，上传安装包、blockmap 和清单至同版本草稿 Release，全部上传成功后发布。
6. 用较旧客户端检查更新，确认下载到 100%、显示更新日志、重启后版本正确。检查用户设置、图片翻译、PSD 出图及桌面快捷方式。

本机已有构建环境时，可运行 `build-nsis.cjs` 构建，再通过 `PICLINGO_UPDATE_PRIVATE_KEY_FILE` 指向上述私钥并运行 `sign-release.cjs outputs/windows-版本号`。只上传签名后的清单及其对应文件。

回退业务版本时，将修复后的旧业务代码发布为更高版本号。客户端禁止自动降级，不能只把线上清单指向更低版本来回退。

## 验收与限制

- 自动检查时间、进度、日志、延期选择、任务保护已有测试。
- 真实 electron-updater 经隔离本机 HTTPS 下载本次真实安装包，并验证发布签名。篡改签名被拒绝。
- 隔离网络测试的服务器证书豁免只存在于测试进程，正式客户端继续要求 HTTPS。
- 线上 GitHub 发布、跨版本在线安装及正式 Mac 自动安装仍待外部发布条件就位后验收。
- 日志位于应用用户数据目录的 `updates/update.log`，设置页可导出日志。

## 旧功能回归检查

- 图片导入、OCR、翻译、译文编辑和导出。
- 离线语言包读取与下载摘要校验。
- PSD 和 Excel 导入、匹配、批量出图与失败报告。
- 蒙层默认值 94%，手动调节范围和玻璃样式。
- 安装路径、个人文件、用户配置及桌面快捷方式。

## 可能出错的 5 个地方

1. 发布仓库尚未创建、仍为私有或没有正式 Release，客户端检查会失败并记录日志。
2. CI 私钥与客户端公钥不配对，构建预检或客户端签名验证会拒绝发布。
3. 安装包与清单来自不同构建，发布工具或客户端 SHA512 校验会失败。
4. 标签、应用版本和更新清单版本不一致，CI 拒绝发布或客户端判断无需升级。
5. 签名凭据缺失、系统安全软件拦截或 Mac 未公证，可能阻止安装，需要按日志和系统提示排查。

