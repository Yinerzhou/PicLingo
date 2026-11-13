# 使用参数绑定读取 Authenticode，避免把缓存路径拼进命令文本。
param([Parameter(Mandatory=$true)][string]$FilePath, [Parameter(Mandatory=$true)][string]$PublishersBase64)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object Text.UTF8Encoding($false)
try {
    $publishers = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($PublishersBase64)) | ConvertFrom-Json
    $signature = Get-AuthenticodeSignature -LiteralPath $FilePath
    if ($signature.Status -ne 'Valid' -or $null -eq $signature.SignerCertificate) { throw ('Invalid Authenticode status: ' + $signature.Status) }
    $name = $signature.SignerCertificate.GetNameInfo([Security.Cryptography.X509Certificates.X509NameType]::SimpleName, $false)
    if (@($publishers) -cnotcontains $name) { throw 'Publisher mismatch' }
    @{ok=$true} | ConvertTo-Json -Compress
} catch { @{ok=$false; message=$_.Exception.Message} | ConvertTo-Json -Compress }

