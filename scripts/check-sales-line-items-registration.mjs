import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const registration = await readFile('tools/register-sales-line-items-task.ps1', 'utf8');

const contracts = [
  ['task name', /\$taskName\s*=\s*"TOBACCO Sales Line Items Push"/],
  ['stable principal', /\$requiredUserId\s*=\s*"OZK2026\\LOQ"/],
  ['Password logon', /-LogonType\s+Password/],
  ['highest run level', /-RunLevel\s+Highest/],
  ['producer path', /Join-Path\s+\$PSScriptRoot\s+"push-sales-line-items\.ps1"/],
  ['Windows PowerShell 5.1', /System32\\WindowsPowerShell\\v1\.0\\powershell\.exe/],
  ['repository working directory', /-WorkingDirectory\s+\$repoRoot/],
  ['repetition interval', /-RepetitionInterval\s+\(New-TimeSpan -Minutes \$IntervalMinutes\)/],
  ['allow battery start', /-AllowStartIfOnBatteries/],
  ['keep running on battery', /-DontStopIfGoingOnBatteries/],
  ['StartWhenAvailable', /-StartWhenAvailable/],
  ['15 minute execution limit', /-ExecutionTimeLimit\s+\(New-TimeSpan -Minutes 15\)/],
  ['IgnoreNew', /-MultipleInstances\s+IgnoreNew/],
  ['restart count', /-RestartCount\s+2/],
  ['restart interval', /-RestartInterval\s+\(New-TimeSpan -Minutes 1\)/],
  ['secure password prompt', /Read-Host[^\n]+-AsSecureString/],
  ['password cleanup', /ZeroFreeBSTR\(\$passwordPointer\)/],
  ['registration credential', /-User\s+\$requiredUserId[\s\S]*?-Password\s+\$plainPassword/],
];

for (const [name, pattern] of contracts) {
  assert.match(registration, pattern, `registration contract missing: ${name}`);
}

const executableLines = registration
  .split(/\r?\n/)
  .filter((line) => !/^\s*#/.test(line))
  .join('\n');
assert.doesNotMatch(executableLines, /Start-ScheduledTask/i);
assert.doesNotMatch(executableLines, /Start-Process|&\s*\$scriptPath|\.\s*\$scriptPath/i);
assert.doesNotMatch(executableLines, /Unregister-ScheduledTask|Set-ScheduledTask/i);
assert.doesNotMatch(executableLines, /\b(?:SYSTEM|OZKSync)\b/i);
assert.doesNotMatch(
  registration,
  /sb_(?:secret|publishable)_[A-Za-z0-9_-]{8,}|postgres(?:ql)?:\/\/|Password\s*=\s*["'][^$]/i,
);
assert.doesNotMatch(registration, /-LogonType\s+(?:Interactive|S4U|ServiceAccount)/i);

console.log('Sales line items scheduled-task registration contract checks passed.');
