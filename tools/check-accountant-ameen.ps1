# check-accountant-ameen.ps1
# Run on the ACCOUNTANT laptop (normal PowerShell is fine, admin not required).
# Read-only diagnostic: checks Al-Ameen version, server connectivity,
# protection-key service reachability and local config, then prints a report.

$out = New-Object System.Collections.Generic.List[string]
function Say([string]$line) { $out.Add($line); Write-Host $line }

Say "=== Ameen client diagnostic $(Get-Date -Format 'yyyy-MM-dd HH:mm') ==="
Say "Computer: $env:COMPUTERNAME  User: $env:USERNAME"

# 1) Al-Ameen client version
$amn = @('C:\Program Files (x86)\alameensoft\Al-Ameen\90\Bin\Amn32.exe',
         'C:\Program Files\alameensoft\Al-Ameen\90\Bin\Amn32.exe') | Where-Object { Test-Path $_ } | Select-Object -First 1
if ($amn) {
    Say "Amn32.exe    : $amn"
    Say "Version      : $((Get-Item $amn).VersionInfo.FileVersion)"
} else {
    Say "Version      : Amn32.exe NOT FOUND"
}

# 2) network path to the server (OZK-TOBACCO)
$server = '192.170.150.13'
Say "--- network to $server (OZK-TOBACCO) ---"
$ping = Test-Connection -ComputerName $server -Count 1 -Quiet -ErrorAction SilentlyContinue
Say "Ping         : $ping"
foreach ($p in 1433, 1947, 947, 445) {
    try {
        $c = New-Object Net.Sockets.TcpClient
        $ok = $c.ConnectAsync($server, $p).Wait(4000) -and $c.Connected
        $c.Close()
    } catch { $ok = $false }
    $label = switch ($p) { 1433 {'SQL Server'} 1947 {'HASP key LM'} 947 {'key svc alt'} 445 {'file/pipes'} }
    Say ("Port {0,-5}   : {1}  ({2})" -f $p, $ok, $label)
}
try {
    $byName = [System.Net.Dns]::GetHostAddresses('OZK-TOBACCO') | ForEach-Object { $_.IPAddressToString }
    Say "Name OZK-TOBACCO resolves to: $($byName -join ', ')"
} catch { Say "Name OZK-TOBACCO : DOES NOT RESOLVE (clients using the name instead of IP will fail)" }

# 3) SQL handshake test (no real credentials - we only care HOW it fails)
Say "--- SQL handshake (expect 'Login failed' if network OK) ---"
try {
    $cn = New-Object System.Data.SqlClient.SqlConnection("Data Source=tcp:$server,1433;User ID=__diag__;Password=__diag__;Connect Timeout=8")
    $cn.Open(); $cn.Close()
    Say "SQL test     : connected (unexpected)"
} catch {
    $m = $_.Exception.Message
    if ($m -match 'Login failed')      { Say "SQL test     : NETWORK OK (server answered: login failed - normal for diag)" }
    elseif ($m -match 'network|timeout|error: 40|error: 0') { Say "SQL test     : NETWORK PROBLEM -> $($m.Substring(0,[Math]::Min(160,$m.Length)))" }
    else                               { Say "SQL test     : $($m.Substring(0,[Math]::Min(160,$m.Length)))" }
}

# 4) Al-Ameen local connection/key config (registry dump)
Say "--- Al-Ameen registry config ---"
foreach ($root in 'HKCU:\SOFTWARE\SyrianSoft', 'HKCU:\SOFTWARE\alameensoft',
                  'HKLM:\SOFTWARE\WOW6432Node\SyrianSoft', 'HKLM:\SOFTWARE\WOW6432Node\alameensoft') {
    if (Test-Path $root) {
        Get-ChildItem $root -Recurse -ErrorAction SilentlyContinue | ForEach-Object {
            $k = $_
            ($k | Get-ItemProperty -ErrorAction SilentlyContinue).PSObject.Properties |
                Where-Object { $_.Name -notmatch '^PS' -and $_.Name -notmatch '(?i)pass|pwd' } |
                ForEach-Object { Say "  [$($k.Name -replace '^HKEY_[A-Z_]+\\','')] $($_.Name) = $($_.Value)" }
        }
    }
}

# 5) recent Windows app errors mentioning Amn (last 24h)
Say "--- recent app errors (Amn*) ---"
try {
    Get-WinEvent -FilterHashtable @{LogName='Application'; Level=2; StartTime=(Get-Date).AddDays(-1)} -ErrorAction Stop |
        Where-Object { $_.Message -match 'Amn|Ameen' } | Select-Object -First 5 |
        ForEach-Object { Say "  $($_.TimeCreated)  $(($_.Message -replace '\s+',' ').Substring(0,[Math]::Min(150,$_.Message.Length)))" }
} catch { Say "  (none found)" }

$rep = "$env:USERPROFILE\Desktop\ameen-diag-report.txt"
$out | Out-File $rep -Encoding utf8
Say ""
Say "DONE. Report saved to Desktop: ameen-diag-report.txt - send it back."
