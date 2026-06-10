# ============================================================
# check-ameen-balances.ps1  (قراءة فقط — لا يعدّل أي شيء)
# فحص مطابقة أرصدة الزبائن: يفصّل رصيد عينة زبائن حسب العملة
# من قاعدة الأمين، ويكشف مكان سكربت رفع الأرصدة (الوكيل).
# ============================================================
param(
    [string]$EnvFile = "$PSScriptRoot\.env",
    [string]$OutFile = "$PSScriptRoot\logs\ameen-balance-check.txt"
)

if (Test-Path $EnvFile) {
    Get-Content $EnvFile | Where-Object { $_ -match '^\s*[^#].+=.+' } | ForEach-Object {
        $parts = $_ -split '=', 2
        [System.Environment]::SetEnvironmentVariable($parts[0].Trim(), $parts[1].Trim())
    }
}

$connStr = $env:AMEEN_SQL_WRITE_CONNECTION_STRING
if (-not $connStr) {
    Write-Host "خطأ: AMEEN_SQL_WRITE_CONNECTION_STRING غير موجود في tools\.env" -ForegroundColor Red
    exit 1
}

$logDir = Split-Path $OutFile -Parent
if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Path $logDir -Force | Out-Null }
"" | Set-Content -Path $OutFile -Encoding UTF8

function Write-Both($text) {
    Write-Host $text
    $text | Add-Content -Path $OutFile -Encoding UTF8
}

function Run-Query($conn, $sql, $maxRows = 60) {
    try {
        $cmd = $conn.CreateCommand()
        $cmd.CommandText = $sql
        $reader = $cmd.ExecuteReader()
        $cols = @()
        for ($i = 0; $i -lt $reader.FieldCount; $i++) { $cols += $reader.GetName($i) }
        Write-Both ("الأعمدة: " + ($cols -join " | "))
        $count = 0
        while ($reader.Read() -and $count -lt $maxRows) {
            $vals = @()
            for ($i = 0; $i -lt $reader.FieldCount; $i++) {
                $v = $reader.GetValue($i)
                if ($v -is [string] -and $v.Length -gt 50) { $v = $v.Substring(0, 50) }
                $vals += "$v"
            }
            Write-Both ("  " + ($vals -join " | "))
            $count++
        }
        $reader.Close()
        return $true
    } catch {
        Write-Both ("  تعذّر: " + $_.Exception.Message)
        return $false
    }
}

try {
    Add-Type -AssemblyName "System.Data"
    $conn = New-Object System.Data.SqlClient.SqlConnection($connStr)
    $conn.Open()

    Write-Both "=== (1) أعمدة جدول القيود en000 ==="
    Run-Query $conn "SELECT COLUMN_NAME, DATA_TYPE FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'en000' ORDER BY ORDINAL_POSITION" 60 | Out-Null

    Write-Both ""
    Write-Both "=== (2) أعمدة جدول الزبائن cu000 ==="
    Run-Query $conn "SELECT COLUMN_NAME, DATA_TYPE FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'cu000' ORDER BY ORDINAL_POSITION" 60 | Out-Null

    Write-Both ""
    Write-Both "=== (3) جدول العملات ==="
    Run-Query $conn "SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME LIKE '%urrenc%' OR TABLE_NAME LIKE 'cr0%' OR TABLE_NAME LIKE 'my0%'" 20 | Out-Null
    Write-Both "--- محتوى cr000 (إن وجد) ---"
    Run-Query $conn "SELECT TOP 10 * FROM cr000" 10 | Out-Null

    Write-Both ""
    Write-Both "=== (4) تفصيل أرصدة عينة زبائن حسب العملة (من قيود en000) ==="
    $samples = @("الحاج ابو ظافر", "هادي الغميان ركن الدين", "ابو علي اسعد / جرمانا", "مركز شريفة / اسعد شريفة")
    foreach ($name in $samples) {
        Write-Both ("--- الزبون: $name ---")
        $cmd = $conn.CreateCommand()
        $cmd.CommandText = @"
SELECT en.CurrencyGUID,
       COUNT(*) AS entries,
       CAST(SUM(COALESCE(en.Debit,0)) AS decimal(18,3)) AS total_debit,
       CAST(SUM(COALESCE(en.Credit,0)) AS decimal(18,3)) AS total_credit,
       CAST(SUM(COALESCE(en.Debit,0) - COALESCE(en.Credit,0)) AS decimal(18,3)) AS balance
FROM dbo.en000 en
JOIN dbo.cu000 cu ON cu.AccountGUID = en.AccountGUID
WHERE LTRIM(RTRIM(cu.CustomerName)) = LTRIM(RTRIM(@name))
GROUP BY en.CurrencyGUID
"@
        $cmd.Parameters.AddWithValue("@name", $name) | Out-Null
        try {
            $reader = $cmd.ExecuteReader()
            $cols = @(); for ($i = 0; $i -lt $reader.FieldCount; $i++) { $cols += $reader.GetName($i) }
            Write-Both ("الأعمدة: " + ($cols -join " | "))
            while ($reader.Read()) {
                $vals = @(); for ($i = 0; $i -lt $reader.FieldCount; $i++) { $vals += "$($reader.GetValue($i))" }
                Write-Both ("  " + ($vals -join " | "))
            }
            $reader.Close()
        } catch {
            Write-Both ("  تعذّر: " + $_.Exception.Message)
            # محاولة بدون عمود العملة
            $cmd2 = $conn.CreateCommand()
            $cmd2.CommandText = @"
SELECT COUNT(*) AS entries,
       CAST(SUM(COALESCE(en.Debit,0)) AS decimal(18,3)) AS total_debit,
       CAST(SUM(COALESCE(en.Credit,0)) AS decimal(18,3)) AS total_credit,
       CAST(SUM(COALESCE(en.Debit,0) - COALESCE(en.Credit,0)) AS decimal(18,3)) AS balance
FROM dbo.en000 en
JOIN dbo.cu000 cu ON cu.AccountGUID = en.AccountGUID
WHERE LTRIM(RTRIM(cu.CustomerName)) = LTRIM(RTRIM(@name))
"@
            $cmd2.Parameters.AddWithValue("@name", $name) | Out-Null
            $r2 = $cmd2.ExecuteReader()
            while ($r2.Read()) { Write-Both ("  entries=$($r2.GetValue(0)) debit=$($r2.GetValue(1)) credit=$($r2.GetValue(2)) balance=$($r2.GetValue(3))") }
            $r2.Close()
        }
        Write-Both ""
    }

    $conn.Close()

    Write-Both ""
    Write-Both "=== (5) المهام المجدولة التي تشغّل سكربتات PowerShell (للعثور على وكيل رفع الأرصدة) ==="
    Get-ScheduledTask -ErrorAction SilentlyContinue | ForEach-Object {
        foreach ($a in $_.Actions) {
            if ($a.Arguments -match '\.ps1' -or $a.Execute -match 'powershell') {
                Write-Both ("  مهمة: $($_.TaskName) | حالة: $($_.State) | أمر: $($a.Execute) $($a.Arguments)")
            }
        }
    }

    Write-Both ""
    Write-Both "تم. أرسل هذا الملف: $OutFile"
} catch {
    Write-Host ("خطأ: " + $_.Exception.Message) -ForegroundColor Red
    ("خطأ: " + $_.Exception.Message) | Add-Content -Path $OutFile -Encoding UTF8
}
