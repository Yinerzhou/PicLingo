param([string]$HandleValue)
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class PicLingoDwmProbe {
    [DllImport("dwmapi.dll")]
    public static extern int DwmGetWindowAttribute(IntPtr hwnd, int attribute, out int value, int size);
}
'@
$backdrop = 0
$result = [PicLingoDwmProbe]::DwmGetWindowAttribute([IntPtr]([long]$HandleValue),38,[ref]$backdrop,4)
@{ hresult=$result; systemBackdropType=$backdrop; acrylic=($result -eq 0 -and $backdrop -eq 3) } | ConvertTo-Json -Compress
