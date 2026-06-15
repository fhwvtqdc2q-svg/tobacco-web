# ============================================================
# discover-syp-expenses.ps1   (قراءة فقط — لا يغيّر أي شيء)
# يكتشف: العملات (لإيجاد الليرة السورية) + جداول/أسماء الحسابات
# (لإيجاد «صندوق السوري») + أكثر الحسابات حركةً، تمهيداً لبناء
# تقرير «المصاريف اليومية - ما يخرج من صندوق السوري».
# التشغيل:  powershell -NoProfile -ExecutionPolicy Bypass -File ".\tools\discover-syp-expenses.ps1"
# ============================================================
param(
    [int]$Days = 14,
    [string]$EnvFile = "$PSScriptRoot\.env"
)
$ErrorActionPreference = "Stop"

if (Test-Path $EnvFile) {
    Get-Content $EnvFile | Where-Object { $_ -match '^\s*[^#].+=.+' } | ForEach-Object {
        $kv = $_ -split '=', 2; [System.Environment]::SetEnvironmentVariable($kv[0].Trim(), $kv[1].Trim())
    }
}
$connStr = $env:AMEEN_SQL_CONNECTION_STRING
if (-not $connStr) { $connStr = $env:AMEEN_SQL_WRITE_CONNECTION_STRING }
if (-not $connStr) { throw "لا يوجد AMEEN_SQL_CONNECTION_STRING" }

Add-Type -AssemblyName "System.Data"
$conn = New-Object System.Data.SqlClient.SqlConnection($connStr); $conn.Open()

function Dump($title, $sql, $max) {
    Write-Host ""
    Write-Host ("===== " + $title + " =====")
    try {
        $cmd = $conn.CreateCommand(); $cmd.CommandText = $sql; $cmd.CommandTimeout = 180
        $r = $cmd.ExecuteReader()
        $cols = @(); for ($i = 0; $i -lt $r.FieldCount; $i++) { $cols += $r.GetName($i) }
        Write-Host ("الأعمدة: " + ($cols -join " | "))
        $n = 0
        while ($r.Read() -and $n -lt $max) {
            $n++
            $vals = @()
            for ($i = 0; $i -lt $r.FieldCount; $i++) {
                $v = if ($r.IsDBNull($i)) { "" } else { [string]$r.GetValue($i) }
                if ($v.Length -gt 30) { $v = $v.Substring(0, 30) }
                $vals += $v
            }
            Write-Host ("  " + ($vals -join " | "))
        }
        $r.Close()
        Write-Host ("(عدد الصفوف المعروضة: $n)")
    } catch {
        Write-Host ("تعذّر: " + $_.Exception.Message)
    }
}

# 1) العملات — لإيجاد رقم (GUID) الليرة السورية
Dump "العملات (my000)" "SELECT * FROM my000" 40

# 2) شكل جدول الحسابات (للاطّلاع على عمود الاسم)
Dump "عيّنة جدول الحسابات vwExtended_AC" "SELECT TOP 3 * FROM vwExtended_AC" 3

# 3) أكثر الحسابات حركةً خلال آخر N يوم (الصناديق ستظهر هنا بكثرة)
#    نعرض GUID الحساب + العملة + عدد الحركات + مجموع المدين/الدائن
Dump "أكثر الحسابات حركةً (آخر $Days يوم)" @"
SELECT TOP 40 en.AccountGUID,
       en.CurrencyGUID,
       COUNT(*) AS entries,
       CAST(SUM(COALESCE(en.Debit,0))  AS decimal(18,2)) AS total_debit,
       CAST(SUM(COALESCE(en.Credit,0)) AS decimal(18,2)) AS total_credit
FROM en000 en
WHERE en.Date >= DATEADD(day, -$Days, CAST(GETDATE() AS date))
GROUP BY en.AccountGUID, en.CurrencyGUID
ORDER BY COUNT(*) DESC
"@ 40

# 4) محاولة عرض أسماء الحسابات الأكثر حركةً (إن نجح الربط مع vwExtended_AC)
Dump "أسماء أكثر الحسابات حركةً (آخر $Days يوم)" @"
SELECT TOP 40 a.*, x.entries, x.total_debit, x.total_credit
FROM (
  SELECT en.AccountGUID AS gid,
         COUNT(*) AS entries,
         CAST(SUM(COALESCE(en.Debit,0))  AS decimal(18,2)) AS total_debit,
         CAST(SUM(COALESCE(en.Credit,0)) AS decimal(18,2)) AS total_credit
  FROM en000 en
  WHERE en.Date >= DATEADD(day, -$Days, CAST(GETDATE() AS date))
  GROUP BY en.AccountGUID
) x
JOIN vwExtended_AC a ON a.GUID = x.gid
ORDER BY x.entries DESC
"@ 40

$conn.Close()
Write-Host ""
Write-Host "انتهى الاكتشاف. انسخ كل ما ظهر وابعته للمساعد."
