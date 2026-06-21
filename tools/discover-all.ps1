# ============================================================
# discover-all.ps1   (قراءة فقط — لا يكتب ولا يرفع شيئاً)
# يطبع ما نحتاجه لإصلاح الفواتير وبناء الملخص اليومي الشامل:
#   A) أعمدة bi000 + عيّنة أسطر فاتورة (سعر/إجمالي السطر مقابل إجمالي الفاتورة)
#   B) مبيعات اليوم حسب نوع الفاتورة والعملة (مبيعات/مركز/طلبيات)
#   C) الحسابات التي عليها حركة اليوم (لتحديد الصناديق)
#   D) مصاريف اليوم (أكواد 5xx)
# التشغيل:  .\tools\discover-all.ps1
# ============================================================
param([string]$EnvFile = "$PSScriptRoot\.env")
$ErrorActionPreference = "Stop"
if (Test-Path $EnvFile) {
    Get-Content $EnvFile | Where-Object { $_ -match '^\s*[^#].+=.+' } | ForEach-Object {
        $kv = $_ -split '=', 2; [Environment]::SetEnvironmentVariable($kv[0].Trim(), $kv[1].Trim())
    }
}
function GS($n){ $v=[Environment]::GetEnvironmentVariable($n,"Process"); if(-not $v){$v=[Environment]::GetEnvironmentVariable($n,"User")}; return $v }
$cs = GS "AMEEN_SQL_WRITE_CONNECTION_STRING"; if(-not $cs){ $cs = GS "AMEEN_SQL_CONNECTION_STRING" }
if(-not $cs){ Write-Host "khata: AMEEN_SQL connection string naqis."; exit 1 }

Add-Type -AssemblyName "System.Data"
$cn = New-Object System.Data.SqlClient.SqlConnection($cs); $cn.Open()
function Q($sql){ $c=$cn.CreateCommand(); $c.CommandText=$sql; $c.CommandTimeout=180; return $c.ExecuteReader() }
function Cols($t){ $s=@{}; $r=Q "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='$t'"; while($r.Read()){ $s[[string]$r[0]]=$true }; $r.Close(); return $s }
function Pick($s,$names,$fb){ foreach($n in $names){ if($s.ContainsKey($n)){ return $n } }; return $fb }

$bu = Cols "bu000"
$typeCol = Pick $bu @("TypeGUID","BillTypeGUID","BType") "TypeGUID"
$numCol  = Pick $bu @("Number","BillNumber","Num","Serial") $null
$curColBu = Pick $bu @("CurrencyGUID","CurGUID","MyGUID") $null
$bi = Cols "bi000"
$priceCol = Pick $bi @("Price","UnitPrice","SellPrice","PriceUnit") $null
$totalCol = Pick $bi @("TotalPrice","Total","Net","NetTotal","NetValue","Value","Amount","SubTotal","LineTotal") $null

Write-Host "================= A) FATURA: a3midat bi000 ================="
Write-Host ("bi000 columns: " + (($bi.Keys|Sort-Object) -join ", "))
Write-Host ("bu000 cols muhimma: type=$typeCol | number=$numCol | currency=$curColBu")
Write-Host ("auto price=$priceCol | auto line-total=$totalCol")
Write-Host ""
$priceSel = if($priceCol){"COALESCE(bi.[$priceCol],0)"}else{"0"}
$totalSel = if($totalCol){"COALESCE(bi.[$totalCol],0)"}else{"0"}
$numSel = if($numCol){"u.[$numCol]"}else{"CAST(u.GUID AS varchar(40))"}
# آخر فاتورة فيها اسم زبون: نعرض إجمالي الرأس + كل أعمدة الأرقام بالأسطر
$sql = @"
SELECT TOP 12 $numSel AS bill_no, LTRIM(RTRIM(COALESCE(u.Cust_Name,''))) AS cust,
  CAST(COALESCE(u.Total,0) AS decimal(18,3)) AS bill_total,
  LTRIM(RTRIM(COALESCE(m.Name,''))) AS material,
  CAST(COALESCE(bi.Qty,0) AS decimal(18,3)) AS qty,
  CAST(COALESCE(bi.Qty2,0) AS decimal(18,3)) AS qty2,
  CAST($priceSel AS decimal(18,3)) AS price,
  CAST($totalSel AS decimal(18,3)) AS line_total,
  LTRIM(RTRIM(COALESCE(m.Unity,''))) AS unit1, LTRIM(RTRIM(COALESCE(m.Unit2,''))) AS unit2,
  CAST(COALESCE(m.Unit2Fact,0) AS decimal(18,3)) AS u2fact
FROM bu000 u
JOIN bt000 bt ON bt.GUID = u.$typeCol
JOIN bi000 bi ON bi.ParentGUID = u.GUID
JOIN mt000 m ON m.GUID = bi.MatGUID
WHERE bt.BillType=1 AND LTRIM(RTRIM(COALESCE(u.Cust_Name,'')))<>''
ORDER BY u.Date DESC
"@
$r = Q $sql
while($r.Read()){ Write-Host ("  no={0} | {1} | billTotal={2} || {3} | qty={4} qty2={5} u2fact={6} | price={7} lineTotal={8} | {9}/{10}" -f $r["bill_no"],$r["cust"],$r["bill_total"],$r["material"],$r["qty"],$r["qty2"],$r["u2fact"],$r["price"],$r["line_total"],$r["unit1"],$r["unit2"]) }
$r.Close()

Write-Host ""
Write-Host "================= B) MABI3AT al-yawm hasab al-naw3 wal-3umla ================="
$curJoin = if($curColBu){ "LEFT JOIN my000 cur ON cur.GUID = u.$curColBu" } else { "" }
$curSel  = if($curColBu){ "COALESCE(cur.Code,'?')" } else { "'?'" }
$sqlB = @"
SELECT bt.Name AS bill_type, bt.BillType AS bclass, $curSel AS currency,
  COUNT(DISTINCT u.GUID) AS bills, CAST(SUM(COALESCE(u.Total,0)) AS decimal(18,2)) AS total
FROM bu000 u
JOIN bt000 bt ON bt.GUID = u.$typeCol
$curJoin
WHERE u.Date >= CAST(CAST(GETDATE() AS date) AS datetime)
GROUP BY bt.Name, bt.BillType, $curSel
ORDER BY bt.BillType, bt.Name
"@
$r = Q $sqlB
while($r.Read()){ Write-Host ("  [{0}] naw3='{1}' 3umla={2} | fawatir={3} | total={4}" -f $r["bclass"],$r["bill_type"],$r["currency"],$r["bills"],$r["total"]) }
$r.Close()

Write-Host ""
Write-Host "================= C) HISABAT 3alayha haraka al-yawm (li-tahdid al-sanadeeq) ================="
$sqlC = @"
SELECT TOP 40 LTRIM(RTRIM(COALESCE(ac.Code,''))) AS code, LTRIM(RTRIM(COALESCE(ac.Name,''))) AS name,
  CAST(SUM(COALESCE(e.Debit,0)) AS decimal(18,2)) AS debit, CAST(SUM(COALESCE(e.Credit,0)) AS decimal(18,2)) AS credit
FROM en000 e
JOIN vwExtended_AC ac ON ac.GUID = e.AccountGUID
WHERE e.Date >= CAST(CAST(GETDATE() AS date) AS datetime)
GROUP BY ac.Code, ac.Name
ORDER BY (SUM(COALESCE(e.Debit,0))+SUM(COALESCE(e.Credit,0))) DESC
"@
$r = Q $sqlC
while($r.Read()){ Write-Host ("  code={0} | {1} | madin={2} | dain={3}" -f $r["code"],$r["name"],$r["debit"],$r["credit"]) }
$r.Close()

Write-Host ""
Write-Host "================= D) MASAREEF al-yawm (5xx) ================="
$sqlD = @"
SELECT LTRIM(RTRIM(COALESCE(ac.Name,''))) AS name, LTRIM(RTRIM(COALESCE(ac.Code,''))) AS code,
  CAST(SUM(COALESCE(e.Debit,0)-COALESCE(e.Credit,0)) AS decimal(18,2)) AS amount
FROM en000 e
JOIN vwExtended_AC ac ON ac.GUID = e.AccountGUID
WHERE ac.Code LIKE '5%' AND e.Date >= CAST(CAST(GETDATE() AS date) AS datetime)
GROUP BY ac.Name, ac.Code
HAVING SUM(COALESCE(e.Debit,0)-COALESCE(e.Credit,0)) <> 0
ORDER BY ac.Code
"@
$r = Q $sqlD
$any=$false
while($r.Read()){ $any=$true; Write-Host ("  code={0} | {1} | mablagh={2}" -f $r["code"],$r["name"],$r["amount"]) }
$r.Close()
if(-not $any){ Write-Host "  (la masareef al-yawm)" }

$cn.Close()
Write-Host ""
Write-Host "tamm al-fahs. insakh kul al-natija wab3atha."
