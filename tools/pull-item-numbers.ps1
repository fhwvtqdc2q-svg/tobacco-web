# يملأ approved_price_items.item_number من رقم صنف الأمين (mt000.Number).
# قراءة فقط من الأمين؛ يحدّث عمود item_number فقط في Supabase — لا يمسّ الأسعار ولا المخزون.
# التشغيل التجريبي (بلا تعديل):  .\tools\pull-item-numbers.ps1 -WhatIf
# التشغيل الفعلي:               .\tools\pull-item-numbers.ps1
param([switch]$WhatIf)
$ErrorActionPreference = "Stop"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

# نفس تطبيع الاسم المستخدم في ameen-sync-agent.ps1 (item_key = الاسم المطبّع)
function Normalize-ItemName($Value) {
  $text = if ($null -ne $Value) { [string]$Value } else { "" }
  $text = $text.Trim()
  $text = [regex]::Replace($text, '^\d{2,}\s*-\s*', "")
  $text = $text.Replace("أ","ا").Replace("إ","ا").Replace("آ","ا").Replace("ى","ي").Replace("ة","ه")
  $text = [regex]::Replace($text, "[^\p{L}\p{N}]+", " ")
  $text = [regex]::Replace($text, "\s+", " ")
  $n = $text.Trim().ToLowerInvariant()
  switch ($n) {
    "كابتن بلاك كوين ازرق" { return "كابتن بلاك كور ازرق جديد" }
    "كابتن بلاك كوين اسود" { return "كابتن بلاك كور اسود جديد" }
    default { return $n }
  }
}
function Get-EnvVar($name) {
  $v = [Environment]::GetEnvironmentVariable($name, "User")
  if (-not $v) { $v = [Environment]::GetEnvironmentVariable($name, "Process") }
  if (-not $v) { throw "متغير البيئة ناقص: $name" }
  return $v
}

# 1) اقرأ (رقم الصنف، الاسم) من جدول مواد الأمين mt000
$cs = Get-EnvVar "AMEEN_SQL_CONNECTION_STRING"
$cn = New-Object System.Data.SqlClient.SqlConnection $cs
$byKey = @{}
$namesByKey = @{}
$collisions = @{}
try {
  try { $cn.Open() }
  catch {
    try { $cn.Dispose() } catch {}
    $cn = New-Object System.Data.SqlClient.SqlConnection ($cs -replace 'OZK-TOBACCO', '192.168.1.200,1433')
    $cn.Open()
  }
  $cmd = $cn.CreateCommand()
  $cmd.CommandText = "select cast(Number as nvarchar(32)) as num, Name from dbo.mt000 where Name is not null and ltrim(rtrim(Name)) <> '' order by Number"
  $r = $cmd.ExecuteReader()
  while ($r.Read()) {
    $k = Normalize-ItemName $r["Name"]
    $num = ([string]$r["num"]).Trim()
    $nm = ([string]$r["Name"]).Trim()
    if (-not $k -or -not $num) { continue }
    if ($byKey.ContainsKey($k)) {
      # نفس المفتاح المطبّع برقم مختلف = بطاقتان متصادمتان في الأمين
      if ($byKey[$k] -ne $num) {
        if (-not $collisions.ContainsKey($k)) {
          $collisions[$k] = New-Object System.Collections.ArrayList
          [void]$collisions[$k].Add(@{ num = $byKey[$k]; name = $namesByKey[$k] })
        }
        [void]$collisions[$k].Add(@{ num = $num; name = $nm })
      }
      continue
    }
    $byKey[$k] = $num
    $namesByKey[$k] = $nm
  }
  $r.Close()
} finally { $cn.Close() }
Write-Output ("أصناف الأمين (بعد التطبيع): " + $byKey.Count)

# 1-ب) حسم التصادمات: مفتاح مطبّع واحد يحمل أكثر من رقم في الأمين.
# القاعدة: الحسم الصريح أدناه يُعتمد فقط إذا كان الرقم المحسوم لا يزال أحد
# مرشحي التصادم الفعليين (وإلا فربما تغيّرت بطاقات الأمين والحسم صار قديماً)؛
# وأي تصادم غير محسوم أو حسمه لم يعد صالحاً يُستبعد من التحديث كي لا يُكتب
# رقم عشوائي يتبدل بين تشغيلة وأخرى.
# «غلواز كوين اصفر اس سبعه»: الرقم 273 هو البطاقة الحية (مخزون 136 وحركة فواتير
# آخرها 07/01/2026)، بينما 274 بطاقة مكررة فارغة تماماً (صفر مخزون وصفر حركة
# منذ إنشائها؛ الاسمان يختلفان بنقطة واحدة آخر الاسم) — تحقق قراءة فقط 2026-07-23.
$collisionOverrides = @{ "غلواز كوين اصفر اس سبعه" = "273" }
foreach ($k in @($collisions.Keys)) {
  $candidateNums = @($collisions[$k] | ForEach-Object { $_.num })
  $override = if ($collisionOverrides.ContainsKey($k)) { [string]$collisionOverrides[$k] } else { $null }
  if ($override -and ($candidateNums -contains $override)) {
    $byKey[$k] = $override
    Write-Output ("تصادم محسوم صراحة: [" + $k + "] => الرقم " + $override)
  } else {
    $byKey.Remove($k)
    if ($override) {
      Write-Output ("تحذير: الحسم المسجّل [" + $override + "] لم يعد أحد بطاقات هذا التصادم — استُبعد من التحديث ويحتاج مراجعة: [" + $k + "]")
    } else {
      Write-Output ("تحذير: تصادم غير محسوم — استُبعد من التحديث حتى يُوحَّد الاسم في الأمين: [" + $k + "]")
    }
  }
  foreach ($e in $collisions[$k]) { Write-Output ("    " + $e.num + "  -  " + $e.name) }
}

# 2) صادق Supabase
$url = (Get-EnvVar "TOBACCO_SUPABASE_URL").TrimEnd("/")
$key = Get-EnvVar "TOBACCO_SUPABASE_PUBLIC_KEY"
$auth = Invoke-RestMethod -Method Post -Uri "$url/auth/v1/token?grant_type=password" -Headers @{ apikey = $key; Accept = "application/json" } -ContentType "application/json; charset=utf-8" -Body (@{ email = (Get-EnvVar "TOBACCO_SYNC_EMAIL"); password = (Get-EnvVar "TOBACCO_SYNC_PASSWORD") } | ConvertTo-Json)
$hdr = @{ apikey = $key; Authorization = ("Bearer " + $auth.access_token); "Accept-Profile" = "public"; "Content-Profile" = "public" }

# 3) اجلب أصناف الموقع (المفتاح والرقم الحالي)
$items = Invoke-RestMethod -Method Get -Uri "$url/rest/v1/approved_price_items?select=item_key,item_number&limit=5000" -Headers $hdr
Write-Output ("أصناف الموقع: " + $items.Count)

# 4) حدّث item_number للمطابقات فقط (لا يلمس أي عمود آخر)
$matched = 0; $updated = 0; $toUpdate = 0; $sample = @()
foreach ($it in $items) {
  $num = $byKey[(Normalize-ItemName ([string]$it.item_key))]
  if ($num) {
    $matched++
    if ([string]$it.item_number -ne $num) {
      $toUpdate++
      if ($sample.Count -lt 8) { $sample += ("  " + $it.item_key + "  →  " + $num) }
      if (-not $WhatIf) {
        $enc = [uri]::EscapeDataString([string]$it.item_key)
        Invoke-RestMethod -Method Patch -Uri "$url/rest/v1/approved_price_items?item_key=eq.$enc" -Headers ($hdr + @{ Prefer = "return=minimal" }) -ContentType "application/json; charset=utf-8" -Body (@{ item_number = $num } | ConvertTo-Json) | Out-Null
        $updated++
      }
    }
  }
}
Write-Output ("مطابق بالاسم: $matched من " + $items.Count)
if ($WhatIf) {
  Write-Output ("[تجربة] سيُحدَّث: $toUpdate — عيّنة:")
  $sample | ForEach-Object { Write-Output $_ }
} else {
  Write-Output ("حُدّث فعلياً: $updated")
}
