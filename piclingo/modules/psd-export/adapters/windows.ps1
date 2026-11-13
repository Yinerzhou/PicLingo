# Windows COM 桥接。只重试明确被 Photoshop 拒绝的调用，执行结果不确定时停止。
param(
    [Parameter(Mandatory=$true)][string]$Driver,
    [Parameter(Mandatory=$true)][string]$TransportLog,
    [string]$ProgId = 'Photoshop.Application',
    [int]$Retries = 3,
    [int]$DelaySeconds = 2,
    [switch]$Probe
)
$ErrorActionPreference = 'Stop'
$utf8 = New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding = $utf8
$photoshop = $null

function Write-Transport($level, $step, $message, $details) {
    $event = @{time=(Get-Date).ToString('o'); level=$level; step=$step; message=$message; details=$details}
    [IO.File]::AppendAllText($TransportLog, (($event | ConvertTo-Json -Depth 8 -Compress) + "`n"), $utf8)
}

try {
    for ($attempt = 0; $attempt -le $Retries; $attempt++) {
        try {
            if ($null -eq $photoshop) {
                $photoshop = New-Object -ComObject $ProgId
            }
            $version = $photoshop.Version
            Write-Transport 'info' '连接Photoshop' 'COM 连接成功' @{version=$version; attempt=$attempt + 1; progid=$ProgId}
            if ($Probe) {
                # 只读脚本探测能否进入脚本引擎，不修改文档与设置。
                $answer = $photoshop.DoJavaScript('"PICLINGO_PROBE:" + app.version + ":documents=" + app.documents.length;')
            } else {
                $answer = $photoshop.DoJavaScriptFile($Driver)
            }
            Write-Transport 'info' '脚本返回' 'Photoshop 调用结束' @{result=[string]$answer}
            exit 0
        } catch {
            $failure = $_.Exception
            while ($null -ne $failure.InnerException) { $failure = $failure.InnerException }
            $code = $failure.HResult.ToString('X8')
            # RPC_E_CALL_REJECTED / RPC_E_SERVERCALL_RETRYLATER 代表调用尚未获准执行。
            $busy = $code -eq '80010001' -or $code -eq '8001010A'
            Write-Transport 'error' '调用Photoshop' $failure.Message @{
                hresult=$code; attempt=$attempt + 1; full_error=$_.ToString();
                cause='检查 Photoshop 对话框、正在运行的操作、COM 注册及权限级别'
            }
            if (-not $busy -or $attempt -ge $Retries) { throw }
            Write-Transport 'warning' '忙碌重试' 'Photoshop 拒绝调用，等待后重试' @{delay_seconds=$DelaySeconds}
            Start-Sleep -Seconds $DelaySeconds
        }
    }
} catch {
    Write-Transport 'error' 'Windows桥接' $_.ToString() @{stack=$_.ScriptStackTrace}
    exit 2
} finally {
    if ($null -ne $photoshop) {
        [void][Runtime.InteropServices.Marshal]::ReleaseComObject($photoshop)
    }
}

