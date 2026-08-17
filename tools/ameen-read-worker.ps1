param([int]$PollSeconds=3)
$ErrorActionPreference="Stop"
[Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12
function Require-Env($Name){$v=[Environment]::GetEnvironmentVariable($Name,"User");if(-not $v){$v=[Environment]::GetEnvironmentVariable($Name,"Process")};if(-not $v){throw "Missing environment variable: $Name"};$v}
function Session($Url,$Key,$Email,$Password){Invoke-RestMethod -Method Post -Uri "$Url/auth/v1/token?grant_type=password" -Headers @{apikey=$Key} -ContentType "application/json" -Body (@{email=$Email;password=$Password}|ConvertTo-Json)}
function Broker($Url,$Key,$Token,$Body){Invoke-RestMethod -Method Post -Uri "$Url/functions/v1/ameen-read-broker" -Headers @{apikey=$Key;Authorization="Bearer $Token"} -ContentType "application/json" -Body ($Body|ConvertTo-Json -Depth 30)}
$url=(Require-Env "TOBACCO_SUPABASE_URL").TrimEnd('/');$key=Require-Env "TOBACCO_SUPABASE_PUBLIC_KEY";$email=Require-Env "TOBACCO_SYNC_EMAIL";$password=Require-Env "TOBACCO_SYNC_PASSWORD"
$session=Session $url $key $email $password;$token=$session.access_token
while($true){
 try{
  $poll=Broker $url $key $token @{action='poll'};$job=$poll.job
  if($job){
   try{$result=& "$PSScriptRoot\ameen-read-gateway.ps1" -Resource ([string]$job.resource)|ConvertFrom-Json;Broker $url $key $token @{action='complete';id=[string]$job.id;ok=$true;response=$result}|Out-Null}
   catch{Broker $url $key $token @{action='complete';id=[string]$job.id;ok=$false;error=$_.Exception.Message}|Out-Null}
  }
 }catch{
  # Refresh expired auth once, then continue polling.
  if($_.Exception.Message -match '401|JWT|token'){$session=Session $url $key $email $password;$token=$session.access_token}else{Write-Warning ("Ameen read worker: "+$_.Exception.Message)}
 }
 Start-Sleep -Seconds ([math]::Max(2,$PollSeconds))
}
