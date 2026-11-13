# 从源码构建两个后端和 NSIS 安装包，更新凭据通过环境变量提供。
$ErrorActionPreference = 'Stop'
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..\..'))
function Checked([string]$program, [string[]]$arguments) {
    & $program @arguments
    if ($LASTEXITCODE -ne 0) { throw ('构建失败 ' + $program + '，退出码 ' + $LASTEXITCODE) }
}
Push-Location $root
try {
    Checked 'python' @('-c','import sys; assert sys.version_info[:2] == (3,12), "需要 Python 3.12"')
    $ocrEnvironment = Join-Path $root 'work\venv'
    $psdEnvironment = Join-Path $root 'modules\psd-export\.venv'
    foreach ($environment in @($ocrEnvironment,$psdEnvironment)) {
        if (-not (Test-Path -LiteralPath $environment)) { Checked 'python' @('-m','venv',$environment) }
    }
    $ocrPython = Join-Path $ocrEnvironment 'Scripts\python.exe'
    $psdPython = Join-Path $psdEnvironment 'Scripts\python.exe'
    Checked $ocrPython @('-m','pip','install','-r','work/requirements.txt')
    Checked $psdPython @('-m','pip','install','-r','modules/psd-export/requirements.txt','pyinstaller==6.19.0')
    Checked $psdPython @('-c','import sys;sys.path.insert(0,"modules/psd-export/packaging");from models import ensure_models;ensure_models(".")')
    Checked $ocrPython @('-m','PyInstaller','--noconfirm','--distpath','work/worker-dist','--workpath','work/worker-build','work/PicLingoWorker.spec')
    Checked $psdPython @('-m','PyInstaller','--noconfirm','--distpath','modules/psd-export/release/worker-dist','--workpath','modules/psd-export/release/worker-build','modules/psd-export/packaging/psd.spec')
    $module = Join-Path $root 'modules\psd-export'
    $uiModule = Join-Path $root 'outputs\PicLingo-Liquid-Glass\modules\psd-export'
    foreach ($name in @('electron.cjs','security.cjs','packaging\updates.cjs','packaging\smoke.cjs','packaging\verify-signature.cjs','packaging\verify-signature.ps1')) { Copy-Item -LiteralPath (Join-Path $module $name) -Destination (Join-Path $uiModule $name) -Force }
    Copy-Item -Path (Join-Path $module 'renderer\*') -Destination (Join-Path $uiModule 'renderer') -Force
    Checked 'npm.cmd' @('ci','--prefix','outputs/PicLingo-Liquid-Glass','--ignore-scripts','--no-audit','--no-fund')
    Checked 'npm.cmd' @('ci','--prefix','modules/psd-export/packaging','--ignore-scripts','--no-audit','--no-fund')
    $maintenance = Join-Path $module 'release\PicLingoMaintenance.exe'
    Checked (Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe') @('/nologo','/target:exe','/optimize+','/codepage:65001','/r:System.Web.Extensions.dll',('/out:' + $maintenance),(Join-Path $PSScriptRoot 'Maintenance.cs'))
    Checked 'node' @('modules/psd-export/packaging/build-nsis.cjs')
} finally { Pop-Location }

