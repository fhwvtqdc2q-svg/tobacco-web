import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const registration = await readFile('tools/register-purchase-item-snapshot-task.ps1', 'utf8');
const contracts = [
  ['fixed task name', /\$taskName\s*=\s*"TOBACCO Ameen Item Snapshot Refresh"/],
  ['ReplaceExisting opt-in', /\[Switch\]\$ReplaceExisting/],
  ['existing task preflight', /Get-ScheduledTask\s+-TaskName\s+\$taskName\s+-ErrorAction\s+SilentlyContinue/],
  ['fixed principal', /\$requiredUserId\s*=\s*"OZK2026\\LOQ"/],
  ['Password logon', /-LogonType\s+Password/],
  ['highest run level', /-RunLevel\s+Highest/],
  ['secure password prompt', /Read-Host[^\n]+-AsSecureString/],
  ['password cleanup', /ZeroFreeBSTR\(\$passwordPointer\)/],
  ['allow battery start', /-AllowStartIfOnBatteries/],
  ['keep running on battery', /-DontStopIfGoingOnBatteries/],
  ['StartWhenAvailable', /-StartWhenAvailable/],
  ['IgnoreNew', /-MultipleInstances\s+IgnoreNew/],
  ['15-minute execution limit', /-ExecutionTimeLimit\s+\(New-TimeSpan -Minutes 15\)/],
  ['restart count', /-RestartCount\s+2/],
  ['one-minute restart interval', /-RestartInterval\s+\(New-TimeSpan -Minutes 1\)/],
  ['permanent production root', /Documents\\OZK-TOBACCO\\tobacco-web/],
  ['repository working directory', /-WorkingDirectory\s+\$repoRoot/],
  ['daily schedule preserved', /New-ScheduledTaskTrigger\s+-Daily/],
  ['Apply action', /-File `"\$scriptPath`" -Apply/],
];
for (const [name, pattern] of contracts) assert.match(registration, pattern, `missing registration contract: ${name}`);

const preflightIndex = registration.indexOf('Get-ScheduledTask');
const promptIndex = registration.indexOf('Read-Host');
const registerIndex = registration.indexOf('Register-ScheduledTask @registrationParameters');
assert.ok(preflightIndex >= 0 && preflightIndex < promptIndex, 'preflight must precede password prompt');
assert.ok(preflightIndex < registerIndex, 'preflight must precede registration');
const refusalPath = registration.match(/if\s*\(\s*-not\s+\$ReplaceExisting\s*\)\s*\{([\s\S]*?)\n\s*\}/);
assert.ok(refusalPath, 'default existing-task path must reject replacement');
assert.match(refusalPath[1], /throw\s+"[^"]*already exists[^"]*-ReplaceExisting[^"]*"/i);
assert.doesNotMatch(refusalPath[1], /Read-Host|Register-ScheduledTask|Force/i);
assert.match(registration, /if\s*\(\(\$null\s+-ne\s+\$existingTask\)\s+-and\s+\$ReplaceExisting\)[\s\S]*?\["Force"\]\s*=\s*\$true/);

const executable = registration.split(/\r?\n/).filter((line) => !/^\s*#/.test(line)).join('\n');
assert.doesNotMatch(executable, /Start-ScheduledTask|Unregister-ScheduledTask|Set-ScheduledTask/i);
assert.doesNotMatch(executable, /Start-Process|&\s*\$scriptPath|\.\s*\$scriptPath/i);
assert.doesNotMatch(registration, /sb_(?:secret|publishable)_[A-Za-z0-9_-]{8,}|postgres(?:ql)?:\/\/|Password\s*=\s*["'][^$]/i);
assert.doesNotMatch(registration, /-LogonType\s+(?:Interactive|S4U|ServiceAccount)/i);

console.log('Item snapshot scheduled-task registration contract checks passed.');
