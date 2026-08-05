# يقرأ مناقلات المستودعات من Ameen ويرفع تقرير عرض فقط إلى Supabase.
# لا ينفذ أي INSERT/UPDATE/DELETE على قاعدة Ameen؛ الاستعلام أدناه SELECT فقط.
# كل مناقلة تُبنى من مستنديها: إخراج من المصدر + إدخال إلى الوجهة، ويجب أن
# تتطابق الكميات لكل مادة قبل السماح بالرفع.
param(
  [int]$PeriodDays = 60,
  [switch]$WhatIf,
  [string]$EnvFile = "",
  [string]$LogFile = "$PSScriptRoot\logs\warehouse-transfers-sync.log"
)

$ErrorActionPreference = "Stop"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$OUT_NO_ENTRY = "ad2521dc-0981-4751-8542-fb52cad97b05"
$IN_NO_ENTRY = "6caa0de4-faa9-4027-ad83-4562c8f81211"
$OUT_WITH_ENTRY = "43b6cb6a-fd40-473f-8846-4b1064f5318a"
$IN_WITH_ENTRY = "881cb610-3763-4976-9d7f-2f563da2b299"

if ($EnvFile -and (Test-Path -LiteralPath $EnvFile -PathType Leaf)) {
  Get-Content -LiteralPath $EnvFile | Where-Object { $_ -match '^\s*[^#].+=.+' } | ForEach-Object {
    $parts = $_ -split '=', 2
    [Environment]::SetEnvironmentVariable($parts[0].Trim(), $parts[1].Trim(), "Process")
  }
}

function Get-Setting($Name) {
  $value = [Environment]::GetEnvironmentVariable($Name, "Process")
  if (-not $value) { $value = [Environment]::GetEnvironmentVariable($Name, "User") }
  return $value
}

function Write-Log($Message) {
  $line = "{0} {1}" -f (Get-Date).ToString("yyyy-MM-dd HH:mm:ss"), $Message
  Write-Host $line
  $directory = Split-Path -Parent $LogFile
  if ($directory -and -not (Test-Path -LiteralPath $directory)) {
    New-Item -ItemType Directory -Force -Path $directory | Out-Null
  }
  Add-Content -LiteralPath $LogFile -Value $line -Encoding UTF8
}

function Normalize-ItemName($Value) {
  $text = if ($null -ne $Value) { [string]$Value } else { "" }
  $text = $text.Trim()
  $text = [regex]::Replace($text, '^\d{2,}\s*-\s*', "")
  $text = $text.Replace("أ","ا").Replace("إ","ا").Replace("آ","ا").Replace("ى","ي").Replace("ة","ه")
  $text = [regex]::Replace($text, "[^\p{L}\p{N}]+", " ")
  return ([regex]::Replace($text, "\s+", " ")).Trim().ToLowerInvariant()
}

$connectionString = Get-Setting "AMEEN_SQL_CONNECTION_STRING"
if (-not $connectionString) { throw "متغير AMEEN_SQL_CONNECTION_STRING غير موجود." }
$fromDate = (Get-Date).Date.AddDays(-$PeriodDays)

# تصنيف الأنواع حرفي ومحدود بأنواع المناقلة الأربعة المؤكدة. لا نعتمد على اسم
# النوع أو RelatedTo. مفتاح الربط: العائلة + تاريخ المستند + رقم المستند.
$sql = @'
SELECT
  CAST(u.GUID AS varchar(40)) AS document_guid,
  CONVERT(varchar(10), CAST(u.Date AS date), 23) AS document_date,
  CAST(u.Number AS nvarchar(60)) AS document_number,
  CASE
    WHEN LOWER(CAST(u.TypeGUID AS varchar(40))) IN (@outNoEntry, @inNoEntry) THEN 'without_entry'
    ELSE 'with_entry'
  END AS transfer_family,
  CASE
    WHEN LOWER(CAST(u.TypeGUID AS varchar(40))) IN (@outNoEntry, @outWithEntry) THEN 'out'
    ELSE 'in'
  END AS direction,
  CAST(COALESCE(bi.StoreGUID, u.StoreGUID) AS varchar(40)) AS warehouse_guid,
  LTRIM(RTRIM(COALESCE(st.Name, ''))) AS warehouse_name,
  CAST(bi.MatGUID AS varchar(40)) AS item_guid,
  LTRIM(RTRIM(COALESCE(CAST(m.Code AS nvarchar(60)), ''))) AS item_number,
  LTRIM(RTRIM(COALESCE(m.Name, ''))) AS item_name,
  LTRIM(RTRIM(COALESCE(m.Unity, ''))) AS unit_name,
  CAST(SUM(COALESCE(bi.Qty, 0)) AS decimal(18,3)) AS qty
FROM dbo.bu000 u
JOIN dbo.bi000 bi ON bi.ParentGUID = u.GUID
JOIN dbo.mt000 m ON m.GUID = bi.MatGUID
LEFT JOIN dbo.st000 st ON st.GUID = COALESCE(bi.StoreGUID, u.StoreGUID)
WHERE u.Date >= @fromDate
  AND LOWER(CAST(u.TypeGUID AS varchar(40))) IN (@outNoEntry, @inNoEntry, @outWithEntry, @inWithEntry)
GROUP BY u.GUID, CAST(u.Date AS date), u.Number, u.TypeGUID,
  COALESCE(bi.StoreGUID, u.StoreGUID), st.Name, bi.MatGUID, m.Code, m.Name, m.Unity
ORDER BY CAST(u.Date AS date) DESC, u.Number DESC, direction, m.Code
'@

$connection = New-Object System.Data.SqlClient.SqlConnection $connectionString
try {
  try { $connection.Open() }
  catch {
    Write-Log "تعذّر الاتصال باسم الخادم؛ تجري محاولة IP المباشر."
    $connection = New-Object System.Data.SqlClient.SqlConnection ($connectionString -replace 'OZK-TOBACCO', '192.168.1.200,1433')
    $connection.Open()
  }
  $command = $connection.CreateCommand()
  $command.CommandText = $sql
  $command.CommandTimeout = 300
  $command.Parameters.AddWithValue("@fromDate", $fromDate) | Out-Null
  $command.Parameters.AddWithValue("@outNoEntry", $OUT_NO_ENTRY) | Out-Null
  $command.Parameters.AddWithValue("@inNoEntry", $IN_NO_ENTRY) | Out-Null
  $command.Parameters.AddWithValue("@outWithEntry", $OUT_WITH_ENTRY) | Out-Null
  $command.Parameters.AddWithValue("@inWithEntry", $IN_WITH_ENTRY) | Out-Null
  $reader = $command.ExecuteReader()

  $pairs = [ordered]@{}
  while ($reader.Read()) {
    $family = [string]$reader["transfer_family"]
    $date = [string]$reader["document_date"]
    $number = [string]$reader["document_number"]
    $direction = [string]$reader["direction"]
    $key = "$family|$date|$number"
    if (-not $pairs.Contains($key)) {
      $pairs[$key] = [ordered]@{
        key = $key; family = $family; date = $date; number = $number
        out = [ordered]@{ documents = @{}; stores = @{}; items = @{} }
        in = [ordered]@{ documents = @{}; stores = @{}; items = @{} }
      }
    }
    $side = $pairs[$key][$direction]
    $documentGuid = ([string]$reader["document_guid"]).ToLowerInvariant()
    $warehouseGuid = ([string]$reader["warehouse_guid"]).ToLowerInvariant()
    $warehouseName = [string]$reader["warehouse_name"]
    $itemGuid = ([string]$reader["item_guid"]).ToLowerInvariant()
    $qty = [double]$reader["qty"]
    $side.documents[$documentGuid] = $true
    if ($warehouseGuid -and $warehouseName) { $side.stores[$warehouseGuid] = $warehouseName }
    if (-not $side.items.Contains($itemGuid)) {
      $side.items[$itemGuid] = [ordered]@{
        itemKey = Normalize-ItemName ([string]$reader["item_name"])
        itemGuid = $itemGuid
        itemNumber = [string]$reader["item_number"]
        itemName = [string]$reader["item_name"]
        unitName = [string]$reader["unit_name"]
        qty = 0.0
      }
    }
    $side.items[$itemGuid].qty += $qty
  }
  $reader.Close()
} finally {
  if ($connection.State -ne [System.Data.ConnectionState]::Closed) { $connection.Close() }
}

$transfers = New-Object System.Collections.Generic.List[object]
$problems = New-Object System.Collections.Generic.List[string]
foreach ($pairKey in $pairs.Keys) {
  $pair = $pairs[$pairKey]
  if ($pair.out.documents.Count -ne 1 -or $pair.in.documents.Count -ne 1) {
    $problems.Add("${pairKey}: مستندات الإخراج=$($pair.out.documents.Count)، الإدخال=$($pair.in.documents.Count)")
    continue
  }
  if ($pair.out.stores.Count -ne 1 -or $pair.in.stores.Count -ne 1) {
    $problems.Add("${pairKey}: يجب أن يكون لكل طرف مستودع واحد")
    continue
  }
  $allItemGuids = @(@($pair.out.items.Keys) + @($pair.in.items.Keys) | Sort-Object -Unique)
  $items = New-Object System.Collections.Generic.List[object]
  foreach ($itemGuid in $allItemGuids) {
    $outItem = $pair.out.items[$itemGuid]
    $inItem = $pair.in.items[$itemGuid]
    $outQty = if ($outItem) { [double]$outItem.qty } else { 0.0 }
    $inQty = if ($inItem) { [double]$inItem.qty } else { 0.0 }
    if ([math]::Abs($outQty - $inQty) -gt 0.001) {
      $problems.Add("${pairKey}: اختلاف كمية المادة $itemGuid (إخراج=$outQty، إدخال=$inQty)")
      continue
    }
    $base = if ($outItem) { $outItem } else { $inItem }
    $items.Add([ordered]@{
      itemKey = $base.itemKey; itemGuid = $base.itemGuid; itemNumber = $base.itemNumber
      itemName = $base.itemName; unitName = $base.unitName; qty = [math]::Round($outQty, 3)
    })
  }
  $sourceGuid = [string]@($pair.out.stores.Keys)[0]
  $destinationGuid = [string]@($pair.in.stores.Keys)[0]
  if ($sourceGuid -eq $destinationGuid) {
    $problems.Add("${pairKey}: مستودع المصدر والوجهة متطابقان")
    continue
  }
  $totalQty = 0.0
  foreach ($item in $items) { $totalQty += $item.qty }
  $transfers.Add([ordered]@{
    transferKey = $pair.key
    number = $pair.number
    date = $pair.date
    family = $pair.family
    sourceWarehouseGuid = $sourceGuid
    sourceWarehouseName = [string]$pair.out.stores[$sourceGuid]
    destinationWarehouseGuid = $destinationGuid
    destinationWarehouseName = [string]$pair.in.stores[$destinationGuid]
    itemCount = $items.Count
    totalQty = [math]::Round($totalQty, 3)
    items = $items.ToArray()
  })
}

Write-Log "المناقلات المقروءة: $($pairs.Count)؛ السليمة: $($transfers.Count)؛ المشاكل: $($problems.Count)."
if ($problems.Count -gt 0) {
  $problems | Select-Object -First 20 | ForEach-Object { Write-Log "رفض: $_" }
  throw "فشل تحقق المناقلات؛ لن يُرفع تقرير ناقص أو غير متوازن."
}
if ($WhatIf) {
  $transfers | Group-Object -Property { "{0} إلى {1}" -f $_.sourceWarehouseName, $_.destinationWarehouseName } | ForEach-Object {
    Write-Host ("  {0}: {1} مناقلة" -f $_.Name, $_.Count)
  }
  Write-Log "[تجربة] انتهت القراءة والتحقق؛ لم يُكتب شيء."
  exit 0
}

$url = (Get-Setting "TOBACCO_SUPABASE_URL").TrimEnd("/")
$key = Get-Setting "TOBACCO_SUPABASE_PUBLIC_KEY"
if (-not $key) { $key = Get-Setting "SUPABASE_PUBLIC_KEY" }
$email = Get-Setting "TOBACCO_SYNC_EMAIL"
$password = Get-Setting "TOBACCO_SYNC_PASSWORD"
if (-not $url -or -not $key -or -not $email -or -not $password) { throw "إعدادات Supabase للمزامنة ناقصة." }

$login = Invoke-RestMethod -Method Post -Uri "$url/auth/v1/token?grant_type=password" `
  -Headers @{ apikey = $key } -ContentType "application/json; charset=utf-8" `
  -Body ([Text.Encoding]::UTF8.GetBytes((@{ email = $email; password = $password } | ConvertTo-Json -Compress)))
$headers = @{
  apikey = $key; Authorization = "Bearer $($login.access_token)"; Prefer = "return=minimal"
  "Accept-Profile" = "public"; "Content-Profile" = "public"
}
$payload = @{
  report_date = (Get-Date).ToString("yyyy-MM-dd")
  created_by = $login.user.id
  summary = @{
    source = "ameen_warehouse_transfers"; periodDays = $PeriodDays
    fromDate = $fromDate.ToString("yyyy-MM-dd"); transferCount = $transfers.Count
    generated_at = (Get-Date).ToUniversalTime().ToString("o")
  }
  items = $transfers.ToArray()
} | ConvertTo-Json -Depth 12 -Compress

Invoke-RestMethod -Method Post -Uri "$url/rest/v1/ameen_warehouse_transfer_reports" `
  -Headers $headers -ContentType "application/json; charset=utf-8" `
  -Body ([Text.Encoding]::UTF8.GetBytes($payload)) | Out-Null
$cutoff = (Get-Date).ToUniversalTime().AddDays(-2).ToString("yyyy-MM-ddTHH:mm:ssZ")
try {
  Invoke-RestMethod -Method Delete -Uri "$url/rest/v1/ameen_warehouse_transfer_reports?created_at=lt.$cutoff" `
    -Headers $headers | Out-Null
} catch { Write-Log "تنبيه: تعذّر تنظيف تقارير المناقلات القديمة: $($_.Exception.Message)" }
Write-Log "تم رفع تقرير المناقلات بنجاح."
