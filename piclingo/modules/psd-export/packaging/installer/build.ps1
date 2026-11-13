[CmdletBinding()]
param(
    [string]$WorkspaceRoot,
    [string]$AppDirectory,
    [string]$IconPath,
    [string]$PayloadZip,
    [string]$OutputPath,
    [switch]$CompileCheck,
    [switch]$UseExistingPayload
)

$ErrorActionPreference = 'Stop'
if (-not $WorkspaceRoot) { $WorkspaceRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..\..\..')) }
$WorkspaceRoot = [System.IO.Path]::GetFullPath($WorkspaceRoot)
if (-not $AppDirectory) { $AppDirectory = Join-Path $WorkspaceRoot 'work\desktop-dist-v1.2\PicLingo' }
if (-not $IconPath) { $IconPath = Join-Path $WorkspaceRoot 'work\assets\app.ico' }
if (-not $PayloadZip) { $PayloadZip = Join-Path $PSScriptRoot 'payload.zip' }
if (-not $OutputPath) { $OutputPath = Join-Path $WorkspaceRoot 'outputs\PicLingo-Setup-1.2.0.exe' }
$AppDirectory = [System.IO.Path]::GetFullPath($AppDirectory)
$PayloadZip = [System.IO.Path]::GetFullPath($PayloadZip)
$OutputPath = [System.IO.Path]::GetFullPath($OutputPath)
$compiler = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path -LiteralPath $compiler -PathType Leaf)) { throw 'The .NET Framework C# compiler was not found.' }

$common = @(
    '/nologo', '/target:winexe', '/optimize+', '/platform:anycpu', '/codepage:65001',
    '/r:System.dll', '/r:System.Core.dll', '/r:System.Drawing.dll',
    '/r:System.Windows.Forms.dll', '/r:System.Web.Extensions.dll',
    '/r:System.IO.Compression.dll', '/r:System.IO.Compression.FileSystem.dll',
    ('/win32manifest:' + (Join-Path $PSScriptRoot 'app.manifest'))
)
if (Test-Path -LiteralPath $IconPath -PathType Leaf) { $common += '/win32icon:' + $IconPath }
elseif (-not $CompileCheck) { throw ('Application icon not found: ' + $IconPath) }
$shared = Join-Path $PSScriptRoot 'Shared.cs'
$assembly = Join-Path $PSScriptRoot 'AssemblyInfo.cs'

if ($CompileCheck) {
    $checkDirectory = Join-Path $PSScriptRoot 'build-check'
    [System.IO.Directory]::CreateDirectory($checkDirectory) | Out-Null
    $uninstaller = Join-Path $checkDirectory 'Uninstall.exe'
    $setup = Join-Path $checkDirectory 'PicLingo-Setup-CompileCheck.exe'
    $arguments = $common + @('/main:PicLingo.Installation.UninstallProgram', ('/out:' + $uninstaller), $shared, $assembly, (Join-Path $PSScriptRoot 'Uninstall.cs'))
    & $compiler @arguments
    if ($LASTEXITCODE -ne 0) { throw 'Uninstaller compilation failed.' }
    $arguments = $common + @('/main:PicLingo.Installation.SetupProgram', ('/out:' + $setup), $shared, $assembly, (Join-Path $PSScriptRoot 'Setup.cs'))
    & $compiler @arguments
    if ($LASTEXITCODE -ne 0) { throw 'Setup compilation failed.' }
    Write-Output ('COMPILE_OK: ' + $checkDirectory)
    return
}

if (-not (Test-Path -LiteralPath (Join-Path $AppDirectory 'PicLingo.exe') -PathType Leaf)) {
    throw ('Build the main app first: ' + (Join-Path $AppDirectory 'PicLingo.exe'))
}
[System.IO.Directory]::CreateDirectory((Join-Path $AppDirectory 'assets')) | Out-Null
$installedIcon = Join-Path $AppDirectory 'assets\app.ico'
if (-not [string]::Equals([System.IO.Path]::GetFullPath($IconPath), [System.IO.Path]::GetFullPath($installedIcon), [System.StringComparison]::OrdinalIgnoreCase)) {
    Copy-Item -LiteralPath $IconPath -Destination $installedIcon -Force
}
$uninstaller = Join-Path $AppDirectory 'Uninstall.exe'
$arguments = $common + @('/main:PicLingo.Installation.UninstallProgram', ('/out:' + $uninstaller), $shared, $assembly, (Join-Path $PSScriptRoot 'Uninstall.cs'))
& $compiler @arguments
if ($LASTEXITCODE -ne 0) { throw 'Uninstaller compilation failed.' }

if (-not $UseExistingPayload) {
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    if (Test-Path -LiteralPath $PayloadZip) { Remove-Item -LiteralPath $PayloadZip -Force }
    [System.IO.Compression.ZipFile]::CreateFromDirectory($AppDirectory, $PayloadZip, [System.IO.Compression.CompressionLevel]::Optimal, $false)
}
if (-not (Test-Path -LiteralPath $PayloadZip -PathType Leaf)) { throw ('Payload ZIP not found: ' + $PayloadZip) }
if ($UseExistingPayload) {
    Add-Type -AssemblyName System.IO.Compression
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $archive = [System.IO.Compression.ZipFile]::Open($PayloadZip, [System.IO.Compression.ZipArchiveMode]::Update)
    try {
        $oldUninstaller = $archive.GetEntry('Uninstall.exe')
        if ($oldUninstaller) { $oldUninstaller.Delete() }
        [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive, $uninstaller, 'Uninstall.exe', [System.IO.Compression.CompressionLevel]::Optimal) | Out-Null
    }
    finally { $archive.Dispose() }
}
$checksumPath = [System.IO.Path]::ChangeExtension($PayloadZip, '.sha256')
$checksum = (Get-FileHash -LiteralPath $PayloadZip -Algorithm SHA256).Hash
[System.IO.File]::WriteAllText($checksumPath, $checksum, [System.Text.Encoding]::ASCII)
[System.IO.Directory]::CreateDirectory((Split-Path $OutputPath -Parent)) | Out-Null
$arguments = $common + @(
    '/main:PicLingo.Installation.SetupProgram', ('/out:' + $OutputPath),
    ('/resource:' + $PayloadZip + ',PicLingo.Payload.zip'),
    ('/resource:' + $checksumPath + ',PicLingo.Payload.sha256'),
    $shared, $assembly, (Join-Path $PSScriptRoot 'Setup.cs')
)
& $compiler @arguments
if ($LASTEXITCODE -ne 0) { throw 'Setup compilation failed.' }
Write-Output ('BUILD_OK: ' + $OutputPath)
Write-Output ('SIZE_BYTES: ' + (Get-Item -LiteralPath $OutputPath).Length)
Write-Output ('SHA256: ' + (Get-FileHash -LiteralPath $OutputPath -Algorithm SHA256).Hash)
