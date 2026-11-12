# 在新的源码目录构建两个引擎、Electron 客户端和安装包。
$ErrorActionPreference = 'Stop'
$workspace = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..\..'))
$module = Join-Path $workspace 'modules\psd-export'
$build = Join-Path $module 'release\windows-build'
[IO.Directory]::CreateDirectory($build) | Out-Null
function Invoke-Build([string]$Program, [string[]]$Arguments) {
    & $Program @Arguments
    if ($LASTEXITCODE -ne 0) { throw ('构建失败 ' + $Program + '，退出码 ' + $LASTEXITCODE) }
}
Invoke-Build 'python' @('-c', 'import sys; assert sys.version_info[:2] == (3,12), "需要 Python 3.12"')
$ocrEnvironment = Join-Path $build 'ocr-venv'
if (-not (Test-Path -LiteralPath $ocrEnvironment)) { Invoke-Build 'python' @('-m', 'venv', $ocrEnvironment) }
$ocrPython = Join-Path $ocrEnvironment 'Scripts\python.exe'
Invoke-Build $ocrPython @('-m', 'pip', 'install', '-r', (Join-Path $workspace 'work\requirements.txt'))
$psdEnvironment = Join-Path $module '.venv'
if (-not (Test-Path -LiteralPath $psdEnvironment)) { Invoke-Build 'python' @('-m', 'venv', $psdEnvironment) }
$psdPython = Join-Path $psdEnvironment 'Scripts\python.exe'
Invoke-Build $psdPython @('-m', 'pip', 'install', '-r', (Join-Path $module 'requirements.txt'), 'pyinstaller==6.19.0')
Push-Location $workspace
try {
    Invoke-Build $psdPython @('-c', 'import sys;sys.path.insert(0,"modules/psd-export/packaging");from models import ensure_models;ensure_models(".")')
    Invoke-Build $ocrPython @('-m', 'PyInstaller', '--noconfirm', '--distpath', 'work/worker-dist', '--workpath', 'work/worker-build', 'work/PicLingoWorker.spec')
    Invoke-Build $psdPython @('-m', 'PyInstaller', '--noconfirm', '--distpath', 'modules/psd-export/release/worker-dist', '--workpath', 'modules/psd-export/release/worker-build', 'modules/psd-export/packaging/psd.spec')
    Invoke-Build 'npm.cmd' @('install', '--prefix', 'work/electron-runtime', 'electron@45.3.1', '--no-audit', '--no-fund')
    $app = Join-Path $workspace 'work\desktop-dist-v1.2\PicLingo'
    if (Test-Path -LiteralPath $app) {
        $resolved = [IO.Path]::GetFullPath($app)
        $allowed = [IO.Path]::GetFullPath((Join-Path $workspace 'work')) + '\'
        if (-not $resolved.StartsWith($allowed, [StringComparison]::OrdinalIgnoreCase)) { throw '构建目录越界' }
        if ((Get-Item -LiteralPath $resolved).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw '构建目录不能是链接' }
        $backup = $resolved + '-previous-' + (Get-Date -Format 'yyyyMMdd-HHmmss')
        if (-not $backup.StartsWith($allowed, [StringComparison]::OrdinalIgnoreCase)) { throw '备份路径越界' }
        Move-Item -LiteralPath $resolved -Destination $backup
    }
    Invoke-Build $psdPython @('modules/psd-export/packaging/build-windows.py')
    & (Join-Path $PSScriptRoot 'installer\build.ps1') -WorkspaceRoot $workspace -AppDirectory $app -PayloadZip (Join-Path $module 'release\payload-v12.zip') -OutputPath (Join-Path $workspace 'outputs\PicLingo-Setup-1.2.0.exe')
    if ($LASTEXITCODE -ne 0) { throw '安装包编译失败' }
} finally { Pop-Location }
