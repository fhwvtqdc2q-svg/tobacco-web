# مشغّل واحد لتقرير مخزون المستودعات وتقرير المناقلات (Ameen قراءة فقط).
param(
  [int]$PeriodDays = 60,
  [string]$EnvFile = "$PSScriptRoot\.env"
)

$ErrorActionPreference = "Stop"
& "$PSScriptRoot\push-ameen-warehouse-stock.ps1" -EnvFile $EnvFile
if (-not $?) { throw "فشل رفع مخزون المستودعات." }
& "$PSScriptRoot\push-ameen-warehouse-transfers.ps1" -PeriodDays $PeriodDays -EnvFile $EnvFile
if (-not $?) { throw "فشل رفع تقرير المناقلات." }
