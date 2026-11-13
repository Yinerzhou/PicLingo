# PicLingo 1.3.2 更新使用说明

## 日常使用

应用启动 30 秒后自动检查更新，此后每 4 小时检查一次。新版在后台下载，下载完成后显示更新日志，选择“重启更新”即可完成安装，或选择“下次启动时更新”。出图任务运行时拒绝开始安装，等待任务结束后可再次操作。

设置页可手动检查更新、查看下载进度和导出日志。更新失败记录在应用用户数据目录的 `updates/update.log`，图片翻译和 PSD 出图继续使用。

内置更新仓库为 `Yinerzhou/PicLingo`。这是用户当前已设为公开的原项目仓库。旧版空更新地址自动采用内置源，用户自行填写的有效地址与关闭自动检查的选择会保留。

原 1.1.0 客户端需要一次安装新版，之后可使用客户端内更新。发布页为 https://github.com/Yinerzhou/PicLingo/releases/latest 。

## 本轮改动

- `release-channel.json` 改用实际已公开的 `Yinerzhou/PicLingo`，使客户端无需填写更新地址。
- Windows 发布 workflow 允许使用本仓库 `GITHUB_TOKEN` 上传发行文件，省去跨仓库令牌配置。
- `build-nsis.cjs` 增加可选 `PICLINGO_ELECTRON_DIST`，下载受阻时可以使用已经验证版本的本地 Electron 分发目录完成构建。
- 应用版本与锁文件根版本同步至 1.3.2，更新本次发行说明。

界面视觉、图片翻译与 PSD 业务代码沿用现有实现。

## 发布下一版

增加应用版本号并更新发行说明，构建安装包，为 `latest.yml` 中的真实安装文件摘要生成 Ed25519 签名。上传安装包、blockmap 和签名清单至新版本 GitHub Release，所有文件上传成功后再发布。

公开仓库负责分发，客户端内置公钥负责验证更新发布签名。签名私钥保留在本机 `%LOCALAPPDATA%\PicLingoReleaseKeys\update-ed25519.pem`，需要安全备份。私钥无需提供给客户端。

使用云端全自动构建发布时，需要由仓库管理员在 GitHub Actions Secrets 中配置 `PICLINGO_UPDATE_PRIVATE_KEY`，内容为上述签名私钥。现有 `Release PicLingo Windows` 工作流会检查它是否与客户端公钥一致。私钥和访问令牌均不得提交到仓库或发到聊天。

客户端禁止自动降级。回退业务代码时，将修复后的旧业务代码发布为更高版本号。

## 签名与平台状态

Windows 使用 Ed25519 发布签名和 SHA512 摘要验证更新载荷。当前安装包未配置商业代码签名，首次手动安装可能显示 SmartScreen 提示。

Mac 正式自动安装仍需要 Developer ID 签名与公证配置。Mac Photoshop 和实验性 RTL 排版也需要目标设备及客户样张验收。

## 旧功能回归检查

- 图片导入、OCR、翻译、译文修改与导出。
- 离线语言包与下载摘要校验。
- PSD 与 Excel 导入、匹配、出图和失败报告。
- 蒙层默认值、手动调节及现有玻璃视觉。
- 用户文件、设置与桌面快捷方式。

