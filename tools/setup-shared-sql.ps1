# setup-shared-sql.ps1
# Run ON THE AL-AMEEN LAPTOP in an *Administrator* PowerShell.
# Enables remote TCP access to the local SQL Server so a second
# Al-Ameen client on the same network can use the same database.
# Read-only with respect to data: it only changes SQL network/firewall settings.

$ErrorActionPreference = 'Continue'
$report = New-Object System.Collections.Generic.List[string]
function R([string]$line) { $report.Add($line); Write-Host $line }

R "=== Shared-SQL setup report $(Get-Date -Format 'yyyy-MM-dd HH:mm') ==="
R "Computer name : $env:COMPUTERNAME"

# --- admin check -------------------------------------------------------
$id = [Security.Principal.WindowsIdentity]::GetCurrent()
$pr = New-Object Security.Principal.WindowsPrincipal($id)
if (-not $pr.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Write-Host "ERROR: Please run this in an ADMINISTRATOR PowerShell (right-click PowerShell -> Run as administrator)." -ForegroundColor Red
    exit 1
}

# --- IPv4 addresses ----------------------------------------------------
try {
    $ips = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction Stop |
        Where-Object { $_.IPAddress -notmatch '^(127|169\.254)' } |
        Select-Object -ExpandProperty IPAddress
} catch {
    $ips = [System.Net.Dns]::GetHostAddresses($env:COMPUTERNAME) |
        Where-Object { $_.AddressFamily -eq 'InterNetwork' } |
        ForEach-Object { $_.IPAddressToString }
}
R ("IPv4 addresses: " + ($ips -join ', '))

# --- find SQL instances ------------------------------------------------
$instKey = 'HKLM:\SOFTWARE\Microsoft\Microsoft SQL Server\Instance Names\SQL'
if (-not (Test-Path $instKey)) {
    R "ERROR: No SQL Server instance found on this machine."
    $report | Out-File "$env:USERPROFILE\Desktop\shared-sql-report.txt" -Encoding utf8
    exit 1
}
$instances = (Get-ItemProperty $instKey).PSObject.Properties | Where-Object { $_.Name -notmatch '^PS' }

foreach ($inst in $instances) {
    $name = $inst.Name      # e.g. MSSQLSERVER or SQLEXPRESS
    $idv  = $inst.Value     # e.g. MSSQL12.MSSQLSERVER
    R "--- Instance: $name ($idv) ---"

    $base = "HKLM:\SOFTWARE\Microsoft\Microsoft SQL Server\$idv\MSSQLServer"
    # SQL version
    try {
        $setup = Get-ItemProperty "HKLM:\SOFTWARE\Microsoft\Microsoft SQL Server\$idv\Setup" -ErrorAction Stop
        R "SQL version   : $($setup.Version) (edition: $($setup.Edition))"
    } catch { R "SQL version   : unknown" }
    # auth mode (1 = Windows only, 2 = Mixed)
    try {
        $lm = (Get-ItemProperty $base -ErrorAction Stop).LoginMode
        R "Login mode    : $lm (2 = Mixed/SQL auth enabled)"
    } catch {}

    # enable TCP on port 1433 (default instance) / keep dynamic for named
    $tcpKey = "$base\SuperSocketNetLib\Tcp"
    if (Test-Path $tcpKey) {
        Set-ItemProperty $tcpKey -Name Enabled -Value 1
        $ipAll = "$tcpKey\IPAll"
        if (Test-Path $ipAll) {
            if ($name -eq 'MSSQLSERVER') {
                Set-ItemProperty $ipAll -Name TcpPort -Value '1433'
                Set-ItemProperty $ipAll -Name TcpDynamicPorts -Value ''
                R "TCP enabled   : yes, fixed port 1433"
            } else {
                $cur = Get-ItemProperty $ipAll
                R "TCP enabled   : yes (named instance; port=$($cur.TcpPort) dynamic=$($cur.TcpDynamicPorts))"
            }
        }
    } else {
        R "WARNING: TCP registry key not found - enable TCP/IP manually in SQL Server Configuration Manager."
    }

    # restart the SQL service so TCP takes effect
    $svcName = if ($name -eq 'MSSQLSERVER') { 'MSSQLSERVER' } else { "MSSQL`$$name" }
    try {
        Restart-Service $svcName -Force -ErrorAction Stop
        Start-Sleep -Seconds 5
        R "Service       : $svcName restarted, status $((Get-Service $svcName).Status)"
    } catch {
        R "WARNING: could not restart service $svcName : $($_.Exception.Message)"
    }
}

# --- SQL Browser (needed for named instances) --------------------------
try {
    Set-Service SQLBrowser -StartupType Automatic -ErrorAction Stop
    Start-Service SQLBrowser -ErrorAction Stop
    R "SQL Browser   : running"
} catch { R "SQL Browser   : not started ($($_.Exception.Message))" }

# --- firewall rules ----------------------------------------------------
try {
    if (-not (Get-NetFirewallRule -DisplayName 'SQL Server TCP 1433' -ErrorAction SilentlyContinue)) {
        New-NetFirewallRule -DisplayName 'SQL Server TCP 1433' -Direction Inbound -Protocol TCP -LocalPort 1433 -Action Allow -Profile Any | Out-Null
    }
    if (-not (Get-NetFirewallRule -DisplayName 'SQL Browser UDP 1434' -ErrorAction SilentlyContinue)) {
        New-NetFirewallRule -DisplayName 'SQL Browser UDP 1434' -Direction Inbound -Protocol UDP -LocalPort 1434 -Action Allow -Profile Any | Out-Null
    }
    R "Firewall      : inbound rules added (TCP 1433, UDP 1434)"
} catch { R "Firewall      : FAILED - $($_.Exception.Message)" }

# --- Al-Ameen client version on this laptop ----------------------------
$amnPaths = @(
    'C:\Program Files (x86)\alameensoft\Al-Ameen\90\Bin\Amn32.exe',
    'C:\Program Files\alameensoft\Al-Ameen\90\Bin\Amn32.exe'
)
$found = $false
foreach ($p in $amnPaths) {
    if (Test-Path $p) {
        R "Al-Ameen exe  : $p"
        R "Al-Ameen ver  : $((Get-Item $p).VersionInfo.FileVersion)"
        $found = $true
    }
}
if (-not $found) {
    # fall back: search uninstall registry
    $u = Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*','HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*' -ErrorAction SilentlyContinue |
        Where-Object { $_.DisplayName -match 'Ameen' }
    foreach ($x in $u) { R "Al-Ameen reg  : $($x.DisplayName) $($x.DisplayVersion)" }
    if (-not $u) { R "Al-Ameen ver  : NOT FOUND in default paths" }
}

# --- list Al-Ameen databases -------------------------------------------
try {
    $dbs = sqlcmd -S localhost -E -h -1 -W -Q "SET NOCOUNT ON; SELECT name FROM sys.databases WHERE name LIKE 'mt%' OR name LIKE 'at%' OR name = 'amn'" 2>$null
    R ("Databases     : " + (($dbs | Where-Object { $_ }) -join ', '))
} catch { R "Databases     : sqlcmd not available, skipped" }

# --- save + show -------------------------------------------------------
$out = "$env:USERPROFILE\Desktop\shared-sql-report.txt"
$report | Out-File $out -Encoding utf8
Write-Host ""
Write-Host "DONE. Report saved to: $out" -ForegroundColor Green
Write-Host "Send the report file (or a photo of this screen) back." -ForegroundColor Green
