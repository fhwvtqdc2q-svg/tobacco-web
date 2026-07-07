# ============================================================
# verify-payments.ps1  (قراءة فقط — لا يعدّل شيئاً)
# تدقيق مزامنة الدفعات: يأخذ آخر الدفعات المسجّلة في الأمين ويتأكد أنها
# وصلت للموقع (تقرير الحركات في Supabase) وبالرصيد الصحيح، ويعرض عمر
# آخر مزامنة. مفيد قبل إرسال سندات القبض للزبائن.
# التشغيل:  .\tools\verify-payments.ps1
#           .\tools\verify-payments.ps1 -Last 30
# ============================================================
param(
    [int]$Last = 20,
    [string]$EnvFile = "$PSScriptRoot\.env"
)

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
$connStr = Get-Setting "AMEEN_SQL_WRITE_CONNECTION_STRING"
if (-not $connStr) { $connStr = Get-Setting "AMEEN_SQL_CONNECTION_STRING" }
$supabaseUrl = Get-Setting "TOBACCO_SUPABASE_URL"
if (-not $supabaseUrl) { $supabaseUrl = "https://dyxbirfpxeocqffnfdeb.supabase.co" }
$supabaseUrl = $supabaseUrl.TrimEnd("/")
$apiKey = Get-Setting "TOBACCO_SUPABASE_PUBLIC_KEY"
if (-not $apiKey) { $apiKey = Get-Setting "SUPABASE_PUBLIC_KEY" }
$syncEmail = Get-Setting "TOBACCO_SYNC_EMAIL"
$syncPassword = Get-Setting "TOBACCO_SYNC_PASSWORD"
if (-not $connStr -or -not $apiKey -or -not $syncEmail -or -not $syncPassword) {
    Write-Host "خطأ: إعدادات .env غير مكتملة." -ForegroundColor Red; exit 1
}

Write-Host ""
Write-Host "========== تدقيق مزامنة الدفعات (آخر $Last دفعة) ==========" -ForegroundColor Cyan

# (1) آخر الدفعات من دفتر الأمين بالرصيد المتحرك المعتمد
Add-Type -AssemblyName "System.Data"
$conn = New-Object System.Data.SqlClient.SqlConnection($connStr)
$conn.Open()
$cmd = $conn.CreateCommand()
$cmd.CommandTimeout = 180
$cmd.CommandText = @"
WITH led AS (
    SELECT LTRIM(RTRIM(cu.CustomerName)) AS name,
           COALESCE(CASE WHEN ce.Date >= '2000-01-01' THEN ce.Date END, en.Date) AS dt,
           CASE WHEN COALESCE(en.Notes,'') LIKE N'%افتتاح%' THEN 0 ELSE 1 END AS isopen,
           CASE WHEN COALESCE(en.Credit,0) > 0 THEN 1 ELSE 0 END AS iscredit,
           COALESCE(ce.CreateDate, en.Date) AS sortdt,
           COALESCE(ce.Number, 0) AS cenum,
           en.Number AS num,
           CAST(COALESCE(en.Debit,0)  AS decimal(18,3)) AS debit,
           CAST(COALESCE(en.Credit,0) AS decimal(18,3)) AS credit,
           CAST(SUM(COALESCE(en.Debit,0) - COALESCE(en.Credit,0))
                OVER (PARTITION BY en.AccountGUID
                      ORDER BY COALESCE(CASE WHEN ce.Date >= '2000-01-01' THEN ce.Date END, en.Date),
                               CASE WHEN COALESCE(en.Notes,'') LIKE N'%افتتاح%' THEN 0 ELSE 1 END,
                               CASE WHEN COALESCE(en.Credit,0) > 0 THEN 1 ELSE 0 END,
                               COALESCE(ce.CreateDate, en.Date),
                               COALESCE(ce.Number, 0),
                               en.Number
                      ROWS UNBOUNDED PRECEDING) AS decimal(18,3)) AS balance
    FROM dbo.en000 en
    JOIN dbo.cu000 cu ON cu.AccountGUID = en.AccountGUID
    LEFT JOIN dbo.ce000 ce ON ce.GUID = en.ParentGUID
    WHERE (COALESCE(en.Debit,0) > 0 OR COALESCE(en.Credit,0) > 0)
      AND cu.CustomerName IS NOT NULL AND LTRIM(RTRIM(cu.CustomerName)) <> ''
      AND (cu.bHide IS NULL OR cu.bHide = 0)
)
SELECT TOP ($Last) name, CONVERT(varchar(10), dt, 120) AS d, credit, balance, CONVERT(varchar(19), sortdt, 120) AS created
FROM led
WHERE credit > 0
ORDER BY sortdt DESC
"@
$ameenPays = New-Object System.Collections.Generic.List[object]
$rd = $cmd.ExecuteReader()
while ($rd.Read()) {
    $ameenPays.Add([PSCustomObject]@{
        name = ([string]$rd.GetValue(0)).Trim()
        date = [string]$rd.GetValue(1)
        credit = [double]$rd.GetValue(2)
        balance = [double]$rd.GetValue(3)
        created = [string]$rd.GetValue(4)
    })
}
$rd.Close(); $conn.Close()
Write-Host ("دفعات الأمين المأخوذة: " + $ameenPays.Count)

# (2) تقرير الحركات المرفوع للموقع
$loginBody = (@{ email = $syncEmail; password = $syncPassword } | ConvertTo-Json -Compress)
$session = Invoke-RestMethod -Method Post -Uri "$supabaseUrl/auth/v1/token?grant_type=password" `
    -Headers @{ apikey = $apiKey } -ContentType "application/json; charset=utf-8" `
    -Body ([System.Text.Encoding]::UTF8.GetBytes($loginBody))
$headers = @{ apikey = $apiKey; Authorization = "Bearer $($session.access_token)"; Accept = "application/json"; "Accept-Profile" = "public" }
$reports = @(Invoke-RestMethod -Method Get -Headers $headers `
    -Uri "$supabaseUrl/rest/v1/inventory_reports?select=created_at,summary,items&source=eq.ameen_customer_movements&order=created_at.desc&limit=1")
if (-not $reports.Count) { Write-Host "خطأ: لا يوجد تقرير حركات مرفوع." -ForegroundColor Red; exit 1 }
$rep = $reports[0]
$age = [math]::Round(((Get-Date).ToUniversalTime() - ([datetime]$rep.created_at).ToUniversalTime()).TotalMinutes, 0)
Write-Host ("آخر مزامنة حركات مرفوعة: قبل $age دقيقة") -ForegroundColor $(if ($age -le 10) { "Green" } else { "Yellow" })

# فهرس: زبون → دفعاته المرفوعة
$synced = @{}
foreach ($it in @($rep.items)) {
    $n = ([string]$it.name).Trim()
    $synced[$n] = @($it.movements | Where-Object { [double]$_.credit -gt 0 })
}

# (3) المطابقة دفعة دفعة
$okCount = 0; $missingCount = 0; $diffCount = 0
foreach ($p in $ameenPays) {
    $cands = if ($synced.ContainsKey($p.name)) { $synced[$p.name] } else { @() }
    $hit = $cands | Where-Object {
        [math]::Abs([double]$_.credit - $p.credit) -lt 0.011 -and ([string]$_.date).Substring(0,10) -eq $p.date
    } | Select-Object -First 1
    if (-not $hit) {
        $missingCount++
        Write-Host ("  ⚠ {0} | {1} | دفعة {2}: لم تصل للموقع بعد (سُجّلت {3})" -f $p.name, $p.date, $p.credit, $p.created) -ForegroundColor Yellow
    } elseif ($null -ne $hit.balance -and [math]::Abs([double]$hit.balance - $p.balance) -gt 0.011) {
        $diffCount++
        Write-Host ("  ✗ {0} | {1} | دفعة {2}: رصيد الموقع {3} ≠ رصيد الأمين {4}" -f $p.name, $p.date, $p.credit, $hit.balance, $p.balance) -ForegroundColor Red
    } else {
        $okCount++
    }
}

Write-Host ""
Write-Host ("مطابقة: $okCount | لم تصل بعد: $missingCount | رصيد مختلف: $diffCount") -ForegroundColor $(if ($diffCount -eq 0 -and $missingCount -eq 0) { "Green" } else { "Yellow" })
Write-Host ""
if ($diffCount -eq 0 -and $missingCount -eq 0) {
    Write-Host "================ كل الدفعات وصلت للموقع بأرصدة صحيحة ✓✓ ================" -ForegroundColor Green
} elseif ($diffCount -eq 0) {
    Write-Host "الدفعات الواصلة كلها صحيحة ✓ — والتي «لم تصل بعد» ستصل بالمزامنة القادمة، أو شغّل:" -ForegroundColor Yellow
    Write-Host "    .\tools\push-customer-movements.ps1"
} else {
    Write-Host "================ يوجد فروق أرصدة — أرسل الناتج لكلود ================" -ForegroundColor Red
}
