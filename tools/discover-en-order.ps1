# ============================================================
# discover-en-order.ps1  (قراءة فقط)
# يطبع قيود زبون من en000 بكل حقول الترتيب المحتملة، لمطابقة ترتيب كشف الأمين
# (خاصةً حركات نفس اليوم: مبيع + سند قبض).
# التشغيل:  .\tools\discover-en-order.ps1
#           .\tools\discover-en-order.ps1 -Customer "اسم الزبون"
# ============================================================
param(
    [string]$Customer = "مركز شريفة / اسعد شريفة",
    [string]$EnvFile  = "$PSScriptRoot\.env"
)

if (Test-Path $EnvFile) {
    Get-Content $EnvFile | Where-Object { $_ -match '^\s*[^#].+=.+' } | ForEach-Object {
        $parts = $_ -split '=', 2
        [System.Environment]::SetEnvironmentVariable($parts[0].Trim(), $parts[1].Trim())
    }
}
$connStr = [Environment]::GetEnvironmentVariable("AMEEN_SQL_WRITE_CONNECTION_STRING", "Process")
if (-not $connStr) { $connStr = [Environment]::GetEnvironmentVariable("AMEEN_SQL_CONNECTION_STRING", "Process") }
if (-not $connStr) { $connStr = [Environment]::GetEnvironmentVariable("AMEEN_SQL_WRITE_CONNECTION_STRING", "User") }
if (-not $connStr) { Write-Host "خطأ: connection string غير موجود." -ForegroundColor Red; exit 1 }

try {
    Add-Type -AssemblyName "System.Data"
    $conn = New-Object System.Data.SqlClient.SqlConnection($connStr)
    $conn.Open()
    $cmd = $conn.CreateCommand()
    $cmd.CommandText = @"
SELECT CONVERT(varchar(23), en.Date, 121)          AS EnDate,
       en.Number                                    AS EnNumber,
       CAST(COALESCE(en.Debit,0)  AS decimal(18,3)) AS Debit,
       CAST(COALESCE(en.Credit,0) AS decimal(18,3)) AS Credit,
       en.Type                                      AS Typ,
       COALESCE(en.GCCOriginNumber,'')              AS GccNum,
       CONVERT(varchar(23), en.GCCOriginDate, 121)  AS GccDate,
       LEFT(COALESCE(en.Notes,''), 35)              AS Notes
FROM dbo.en000 en
JOIN dbo.cu000 cu ON cu.AccountGUID = en.AccountGUID
WHERE LTRIM(RTRIM(cu.CustomerName)) = @c
ORDER BY en.Date, en.Number
"@
    $cmd.Parameters.AddWithValue("@c", $Customer) | Out-Null
    $rd = $cmd.ExecuteReader()
    $cols = @(); for ($i=0; $i -lt $rd.FieldCount; $i++) { $cols += $rd.GetName($i) }
    Write-Host ("زبون: $Customer") -ForegroundColor Cyan
    Write-Host ("الترتيب الحالي (en.Date, en.Number):") -ForegroundColor Yellow
    Write-Host ("  " + ($cols -join " | "))
    while ($rd.Read()) {
        $vals = @(); for ($i=0; $i -lt $rd.FieldCount; $i++) { $vals += "$($rd.GetValue($i))" }
        Write-Host ("  " + ($vals -join " | "))
    }
    $rd.Close(); $conn.Close()
} catch {
    Write-Host ("خطأ: " + $_.Exception.Message) -ForegroundColor Red
}
