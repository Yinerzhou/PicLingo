param([Parameter(Mandatory=$true)][string]$FilePathBase64, [Parameter(Mandatory=$true)][string]$PublishersBase64)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object Text.UTF8Encoding($false)
try {
    $publishers = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($PublishersBase64)) | ConvertFrom-Json
    $targetFile = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($FilePathBase64))
    $signature = Get-AuthenticodeSignature -LiteralPath $targetFile
    if ($signature.Status -ne 'Valid' -or $null -eq $signature.SignerCertificate) { throw ('Invalid Authenticode status: ' + $signature.Status) }
    $name = $signature.SignerCertificate.GetNameInfo([Security.Cryptography.X509Certificates.X509NameType]::SimpleName, $false)
    if (@($publishers) -cnotcontains $name) { throw 'Publisher mismatch' }
    @{ok=$true} | ConvertTo-Json -Compress
} catch { @{ok=$false; message=$_.Exception.Message} | ConvertTo-Json -Compress }

