# ============================================================
# Supabase-only producer for public.ameen_item_snapshot.
# It never connects to Ameen. Dry run is the default; -Apply is required to write.
param(
    [switch]$Apply,
    [string]$EnvFile = "$PSScriptRoot\.env",
    [string]$WindowEnd
)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path $PSScriptRoot -Parent
$producer = Join-Path $repoRoot "scripts\refresh-ameen-item-snapshot.mjs"

if (Test-Path -LiteralPath $EnvFile) {
    Get-Content -LiteralPath $EnvFile | Where-Object { $_ -match '^\s*[^#].+=.+' } | ForEach-Object {
        $parts = $_ -split '=', 2
        [Environment]::SetEnvironmentVariable($parts[0].Trim(), $parts[1].Trim(), 'Process')
    }
}

$node = Get-Command node.exe -ErrorAction Stop
if (-not (Test-Path -LiteralPath $producer)) {
    throw "Snapshot producer not found: $producer"
}

$producerArgs = @($producer)
if ($Apply) { $producerArgs += '--apply' }
if ($WindowEnd) { $producerArgs += "--window-end=$WindowEnd" }

& $node.Source @producerArgs
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
exit 0
