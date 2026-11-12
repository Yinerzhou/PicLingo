# 验证安装包完整性、全新安装、升级、两个功能入口及卸载保留用户文件。
$ErrorActionPreference = 'Stop'
$workspace = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..\..'))
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$report = Join-Path $workspace ('modules\psd-export\release\installer-qa-' + $stamp)
[IO.Directory]::CreateDirectory($report) | Out-Null
$setup = Join-Path $workspace 'outputs\PicLingo-Setup-1.2.0.exe'
$oldSetup = Join-Path $workspace 'outputs\PicLingo-Setup-1.1.0.exe'
$env:ELECTRON_RUN_AS_NODE = $null

function Invoke-Checked([string]$Executable, [string[]]$Arguments, [string]$Name) {
    $process = Start-Process -FilePath $Executable -ArgumentList $Arguments -WindowStyle Hidden -PassThru -Wait -RedirectStandardOutput (Join-Path $report ($Name + '-stdout.log')) -RedirectStandardError (Join-Path $report ($Name + '-stderr.log'))
    if ($process.ExitCode -ne 0) { throw ($Name + ' 失败，退出码 ' + $process.ExitCode) }
    Write-Output ($Name + ' PASS')
}

Invoke-Checked $setup @('--verify-payload', '--log', ('"' + (Join-Path $report 'payload.log') + '"')) 'payload'
foreach ($mode in @('clean', 'upgrade')) {
    $install = [IO.Path]::GetFullPath((Join-Path $workspace ('work\install-v1.2-' + $mode + '-' + $stamp)))
    $allowed = [IO.Path]::GetFullPath((Join-Path $workspace 'work')) + [IO.Path]::DirectorySeparatorChar
    if (-not $install.StartsWith($allowed, [StringComparison]::OrdinalIgnoreCase)) { throw '测试安装路径越界' }
    if (Test-Path -LiteralPath $install) { throw '测试目录已存在' }
    $arguments = @('--silent', '--no-launch', '--no-register', '--no-shortcuts', '--dir', ('"' + $install + '"'))
    if ($mode -eq 'upgrade') {
        Invoke-Checked $oldSetup $arguments ($mode + '-old-install')
        [IO.File]::WriteAllText((Join-Path $install 'keep-personal.txt'), 'retain personal file')
    }
    Invoke-Checked $setup $arguments ($mode + '-install')
    $manifest = Get-Content -LiteralPath (Join-Path $install '.piclingo-install.json') -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($manifest.Version -ne '1.2.0' -or $manifest.Registered -or $manifest.DesktopShortcut) { throw '安装清单不符合隔离测试要求' }
    foreach ($relative in @('PicLingo.exe', 'resources\backend\PicLingoWorker.exe', 'resources\psd\PicLingoPSD.exe', 'assets\app.ico')) {
        if (-not (Test-Path -LiteralPath (Join-Path $install $relative))) { throw ('安装缺少文件 ' + $relative) }
    }
    $imageResult = Join-Path $report ($mode + '-image\result.json')
    Invoke-Checked (Join-Path $install 'PicLingo.exe') @(('"--app-smoke=' + $imageResult + '"')) ($mode + '-image')
    $image = Get-Content -LiteralPath $imageResult -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($image.version -ne '1.2.0' -or -not $image.workflow.editedImageChanged -or $image.workflow.modelCount -lt 40) { throw '图片翻译回归失败' }
    $psdRoot = Join-Path $report ($mode + '-psd')
    [IO.Directory]::CreateDirectory($psdRoot) | Out-Null
    $scenario = @{
        files = @((Join-Path $workspace 'modules\psd-export\samples\测试 样本\多层 测试 3层.psd'))
        excel = Join-Path $workspace 'modules\psd-export\samples\测试 样本\翻译 模板.xlsx'
        output = Join-Path $psdRoot 'output'
        result = Join-Path $psdRoot 'result.json'
    }
    $scenarioPath = Join-Path $psdRoot 'scenario.json'
    [IO.File]::WriteAllText($scenarioPath, ($scenario | ConvertTo-Json -Depth 5), (New-Object Text.UTF8Encoding($false)))
    Invoke-Checked (Join-Path $install 'PicLingo.exe') @(('"--psd-smoke=' + $scenarioPath + '"')) ($mode + '-psd')
    $psd = Get-Content -LiteralPath $scenario.result -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($psd.veil -ne '94' -or -not $psd.imagePageRestored -or $psd.status -notlike '*成功 1*失败 0*') { throw 'PSD 页面回归失败' }
    [IO.File]::WriteAllText((Join-Path $install 'keep-personal.txt'), 'retain personal file')
    Invoke-Checked (Join-Path $install 'Uninstall.exe') @('--silent', '--log', ('"' + (Join-Path $report ($mode + '-uninstall.log')) + '"')) ($mode + '-uninstall')
    $deadline = [DateTime]::UtcNow.AddSeconds(15)
    while ((Test-Path -LiteralPath (Join-Path $install 'Uninstall.exe')) -and [DateTime]::UtcNow -lt $deadline) { Start-Sleep -Milliseconds 200 }
    $remaining = @(Get-ChildItem -LiteralPath $install -Force)
    if ($remaining.Count -ne 1 -or $remaining[0].Name -ne 'keep-personal.txt') { throw '卸载残留或用户文件丢失' }
    if ([IO.File]::ReadAllText((Join-Path $install 'keep-personal.txt')) -ne 'retain personal file') { throw '用户文件内容改变' }
    Write-Output ($mode + ' uninstall and personal-file preservation PASS')
}
Write-Output ('ALL_INSTALLER_CHECKS_PASSED ' + $report)
