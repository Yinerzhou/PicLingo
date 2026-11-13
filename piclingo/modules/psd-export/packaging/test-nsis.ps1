# 在隔离目录验收 NSIS 全新安装、旧安装迁移和用户文件保留，恢复注册信息与快捷方式。
$ErrorActionPreference = 'Stop'
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..\..'))
$report = Join-Path $root ('modules\psd-export\release\nsis-qa-' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
[IO.Directory]::CreateDirectory($report) | Out-Null
$guid = & node -e 'const {UUID}=require("./modules/psd-export/packaging/node_modules/builder-util-runtime");process.stdout.write(UUID.v5("com.piclingo.desktop",UUID.parse("50e065bc-3134-11e6-9bab-38c9862bdaf3")))'
$keys = @('Software\Microsoft\Windows\CurrentVersion\Uninstall\PicLingo', ('Software\Microsoft\Windows\CurrentVersion\Uninstall\' + $guid), ('Software\' + $guid))
$savedKeys = @{}
foreach ($key in $keys) {
    $file = Join-Path $report ('registry-' + $savedKeys.Count + '.reg')
    & reg.exe export ('HKCU\' + $key) $file /y 2>$null | Out-Null
    $savedKeys[$key] = @{ existed = ($LASTEXITCODE -eq 0); file = $file }
}
$links = @((Join-Path ([Environment]::GetFolderPath('Desktop')) 'PicLingo 图译工坊.lnk'), (Join-Path ([Environment]::GetFolderPath('Programs')) 'PicLingo 图译工坊\PicLingo 图译工坊.lnk'))
$savedLinks = @{}
foreach ($link in $links) { $savedLinks[$link] = if (Test-Path -LiteralPath $link) { [IO.File]::ReadAllBytes($link) } else { $null } }
$env:ELECTRON_RUN_AS_NODE = $null
function Run([string]$file, [string[]]$arguments, [string]$label) {
    $proc = Start-Process -FilePath $file -ArgumentList $arguments -WindowStyle Hidden -PassThru -Wait -RedirectStandardOutput (Join-Path $report ($label + '.stdout.log')) -RedirectStandardError (Join-Path $report ($label + '.stderr.log'))
    if ($proc.ExitCode -ne 0) { throw ($label + ' 退出码 ' + $proc.ExitCode) }
    Write-Output ($label + ' PASS')
}
try {
    foreach ($mode in @('clean','migration')) {
        $install = Join-Path $report ($mode + '\PicLingo')
        if ($mode -eq 'migration') {
            Run (Join-Path $root 'outputs\PicLingo-Setup-1.2.0.exe') @('--silent','--no-launch','--no-register','--no-shortcuts','--dir',('"' + $install + '"')) 'legacy-install'
            $legacyKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\PicLingo'
            New-Item -Path $legacyKey -Force | Out-Null
            Set-ItemProperty -LiteralPath $legacyKey -Name InstallLocation -Value $install
            [IO.File]::WriteAllText((Join-Path $install 'personal.txt'), 'keep personal content')
        }
        Run (Join-Path $root 'outputs\windows-qa-1.3.0\PicLingo-Setup-1.3.0.exe') @('/S', ('/D=' + $install)) ($mode + '-install')
        if (-not (Test-Path -LiteralPath (Join-Path $install 'PicLingo.exe'))) { throw '安装路径不符' }
        $image = Join-Path $report ($mode + '-image\result.json')
        Run (Join-Path $install 'PicLingo.exe') @(('"--app-smoke=' + $image + '"')) ($mode + '-image')
        $imageResult = Get-Content -LiteralPath $image -Raw | ConvertFrom-Json
        if ($imageResult.version -ne '1.3.0' -or -not $imageResult.workflow.editedImageChanged) { throw '图片回归失败' }
        $scenario = @{ files=@((Join-Path $root 'modules\psd-export\samples\测试 样本\多层 测试 3层.psd')); excel=Join-Path $root 'modules\psd-export\samples\测试 样本\翻译 模板.xlsx'; output=Join-Path $report ($mode + '-psd\output'); result=Join-Path $report ($mode + '-psd\result.json') }
        $scenarioFile = Join-Path $report ($mode + '-scenario.json')
        [IO.File]::WriteAllText($scenarioFile, ($scenario | ConvertTo-Json -Depth 4))
        Run (Join-Path $install 'PicLingo.exe') @(('"--psd-smoke=' + $scenarioFile + '"')) ($mode + '-psd')
        $psd = Get-Content -LiteralPath $scenario.result -Raw | ConvertFrom-Json
        if ($psd.status -notlike '*成功 1*失败 0*' -or -not $psd.imagePageRestored) { throw 'PSD 回归失败' }
        [IO.File]::WriteAllText((Join-Path $install 'personal.txt'), 'keep personal content')
        Run (Join-Path $install 'Uninstall PicLingo.exe') @('/S') ($mode + '-uninstall')
        $deadline = [DateTime]::UtcNow.AddSeconds(20)
        while ((Test-Path -LiteralPath (Join-Path $install 'Uninstall PicLingo.exe')) -and [DateTime]::UtcNow -lt $deadline) { Start-Sleep -Milliseconds 200 }
        $remaining = @(Get-ChildItem -LiteralPath $install -Force)
        if ($remaining.Count -ne 1 -or $remaining[0].Name -ne 'personal.txt') { throw ('卸载残留 ' + ($remaining.Name -join ', ')) }
        if ([IO.File]::ReadAllText((Join-Path $install 'personal.txt')) -ne 'keep personal content') { throw '用户文件改变' }
        Write-Output ($mode + ' personal-file preservation PASS')
    }
    Write-Output ('ALL_NSIS_CHECKS_PASSED ' + $report)
} finally {
    foreach ($key in $keys) {
        & reg.exe delete ('HKCU\' + $key) /f 2>$null | Out-Null
        if ($savedKeys[$key].existed) { & reg.exe import $savedKeys[$key].file | Out-Null }
    }
    foreach ($link in $links) {
        if ($null -ne $savedLinks[$link]) { [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($link)) | Out-Null; [IO.File]::WriteAllBytes($link, $savedLinks[$link]) }
        elseif (Test-Path -LiteralPath $link) { Remove-Item -LiteralPath $link }
    }
}

