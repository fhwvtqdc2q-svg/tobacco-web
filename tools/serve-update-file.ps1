# serve-update-file.ps1 - run as ADMINISTRATOR on the OZK-TOBACCO laptop.
# Serves the already-downloaded Al-Ameen update over the LAN so the
# accountant laptop can grab it at LAN speed (no internet needed).

$path = "$env:LOCALAPPDATA\Temp\amn_update.exe"
$port = 8077

if (-not (Test-Path $path)) {
    # fall back: search likely temp locations
    $cand = @("$env:TEMP\amn_update.exe", "C:\Users\DELL\AppData\Local\Temp\amn_update.exe") | Where-Object { Test-Path $_ } | Select-Object -First 1
    if ($cand) { $path = $cand } else { Write-Host "ERROR: amn_update.exe not found in temp folders" -ForegroundColor Red; exit 1 }
}
$size = [math]::Round((Get-Item $path).Length / 1MB, 1)
Write-Host "found file: $path ($size MB)"
if ($size -lt 200) { Write-Host "WARNING: file looks too small/incomplete!" -ForegroundColor Yellow }

netsh advfirewall firewall delete rule name="amn-lan-share" 2>$null | Out-Null
netsh advfirewall firewall add rule name="amn-lan-share" dir=in action=allow protocol=TCP localport=$port | Out-Null

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://+:$port/")
$listener.Start()

Write-Host ""
Write-Host "READY. On the ACCOUNTANT laptop run these two lines in PowerShell:" -ForegroundColor Green
Write-Host ""
Write-Host "curl.exe --output `"`$env:temp\amn_update.exe`" http://192.170.150.13:$port/" -ForegroundColor Cyan
Write-Host "start-process `"`$env:temp\amn_update.exe`" -wait" -ForegroundColor Cyan
Write-Host ""
Write-Host "(keep THIS window open until the copy finishes; then you can close it)"

$bytes = [System.IO.File]::ReadAllBytes($path)
for ($i = 0; $i -lt 30; $i++) {
    $ctx = $listener.GetContext()
    try {
        $ctx.Response.ContentType = 'application/octet-stream'
        $ctx.Response.ContentLength64 = $bytes.Length
        $ctx.Response.OutputStream.Write($bytes, 0, $bytes.Length)
        $ctx.Response.Close()
        Write-Host "served a download request ($($i+1))"
    } catch { Write-Host "request aborted, waiting for retry..." }
}
