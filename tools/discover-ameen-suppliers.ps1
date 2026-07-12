# ============================================================
# discover-ameen-suppliers.ps1  (READ ONLY)
# Goal: find where supplier accounts live in the Ameen database.
# Does NOT modify or delete anything. Does NOT print any secrets.
# ASCII-only source to avoid PowerShell 5.1 encoding issues.
# ============================================================
param(
    [string]$EnvFile = "$PSScriptRoot\.env"
)
$ErrorActionPreference = "Stop"
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}

# Load settings from .env (same mechanism as the sync scripts)
if (Test-Path $EnvFile) {
    Get-Content $EnvFile | Where-Object { $_ -match '^\s*[^#].+=.+' } | ForEach-Object {
        $parts = $_ -split '=', 2
        [System.Environment]::SetEnvironmentVariable($parts[0].Trim(), $parts[1].Trim())
    }
}
function Get-Setting($Name) {
    $v = [Environment]::GetEnvironmentVariable($Name, "Process")
    if (-not $v) { $v = [Environment]::GetEnvironmentVariable($Name, "User") }
    return $v
}

$connStr = Get-Setting "AMEEN_SQL_CONNECTION_STRING"
if (-not $connStr) { $connStr = Get-Setting "AMEEN_SQL_WRITE_CONNECTION_STRING" }
if (-not $connStr) { Write-Host "ERROR: AMEEN_SQL_CONNECTION_STRING not found in .env"; exit 1 }

Add-Type -AssemblyName "System.Data"
$conn = New-Object System.Data.SqlClient.SqlConnection($connStr)
$conn.Open()

function Run($title, $sql) {
    Write-Host ""
    Write-Host "==================== $title ===================="
    try {
        $cmd = $conn.CreateCommand()
        $cmd.CommandText = $sql
        $reader = $cmd.ExecuteReader()
        $cols = @()
        for ($i = 0; $i -lt $reader.FieldCount; $i++) { $cols += $reader.GetName($i) }
        $header = "[" + ($cols -join " | ") + "]"
        Write-Host $header
        $n = 0
        while ($reader.Read()) {
            $vals = @()
            for ($i = 0; $i -lt $reader.FieldCount; $i++) { $vals += [string]$reader.GetValue($i) }
            $line = ($vals -join " | ")
            Write-Host $line
            $n++
        }
        $reader.Close()
        Write-Host "(rows: $n)"
    } catch {
        Write-Host ("FAILED: " + $_.Exception.Message)
    }
}

# 1) All tables (look for a separate supplier table like su000 / supplier / vendor)
Run "ALL TABLES" "SELECT name FROM sys.tables ORDER BY name"

# 2) Columns of cu000 (accounts) - look for a type/supplier/parent/group flag
Run "cu000 COLUMNS" "SELECT c.name AS col, t.name AS type FROM sys.columns c JOIN sys.types t ON c.user_type_id=t.user_type_id WHERE c.object_id=OBJECT_ID('dbo.cu000') ORDER BY c.column_id"

# 3) Invoice types bt000 (find purchase/input types: bIsInput=1)
Run "bt000 INVOICE TYPES" "SELECT * FROM dbo.bt000"

# 4) Columns of bu000 (invoice headers)
Run "bu000 COLUMNS" "SELECT c.name AS col, t.name AS type FROM sys.columns c JOIN sys.types t ON c.user_type_id=t.user_type_id WHERE c.object_id=OBJECT_ID('dbo.bu000') ORDER BY c.column_id"

# 5) Parties on PURCHASE (input) invoices = likely suppliers. Try both possible column names.
Run "PURCHASE PARTIES (via TypeGUID)" "SELECT TOP 40 LTRIM(RTRIM(bu.Cust_Name)) AS party, COUNT(*) AS bills FROM dbo.bu000 bu JOIN dbo.bt000 bt ON bt.GUID = bu.TypeGUID WHERE bt.bIsInput = 1 GROUP BY LTRIM(RTRIM(bu.Cust_Name)) ORDER BY bills DESC"
Run "PURCHASE PARTIES (via BillTypeGUID)" "SELECT TOP 40 LTRIM(RTRIM(bu.Cust_Name)) AS party, COUNT(*) AS bills FROM dbo.bu000 bu JOIN dbo.bt000 bt ON bt.GUID = bu.BillTypeGUID WHERE bt.bIsInput = 1 GROUP BY LTRIM(RTRIM(bu.Cust_Name)) ORDER BY bills DESC"

# 6) Accounts with net CREDIT balance (we owe them) = classic supplier signature
Run "ACCOUNTS WE OWE (credit balance, top 40)" "SELECT TOP 40 LTRIM(RTRIM(cu.CustomerName)) AS name, CAST(SUM(COALESCE(en.Credit,0)-COALESCE(en.Debit,0)) AS decimal(18,2)) AS net_credit FROM dbo.en000 en JOIN dbo.cu000 cu ON cu.AccountGUID = en.AccountGUID WHERE cu.CustomerName IS NOT NULL AND (cu.bHide IS NULL OR cu.bHide=0) GROUP BY LTRIM(RTRIM(cu.CustomerName)) HAVING SUM(COALESCE(en.Credit,0)-COALESCE(en.Debit,0)) > 0 ORDER BY net_credit DESC"

$conn.Close()
Write-Host ""
Write-Host "==================== DONE (read only) ===================="
