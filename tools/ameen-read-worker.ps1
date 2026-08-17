param(
  [int]$PollSeconds = 3,
  [string]$AgentId = $env:COMPUTERNAME
)
$ErrorActionPreference = "Stop"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

function Require-Env($Name) {
  $v=[Environment]::GetEnvironmentVariable($Name,"User"); if(-not $v){$v=[Environment]::GetEnvironmentVariable($Name,"Process")}
  if(-not $v){throw "Missing environment variable: $Name"}; return $v
}
function Get-Session($Url,$Key,$Email,$Password){
  Invoke-RestMethod -Method Post -Uri "$Url/auth/v1/token?grant_type=password" -Headers @{apikey=$Key} -ContentType "application/json" -Body (@{email=$Email;password=$Password}|ConvertTo-Json)
}
function Headers($Key,$Token){ @{apikey=$Key;Authorization="Bearer $Token"} }

$url=(Require-Env "TOBACCO_SUPABASE_URL").TrimEnd('/'); $key=Require-Env "TOBACCO_SUPABASE_PUBLIC_KEY"
$email=Require-Env "TOBACCO_SYNC_EMAIL"; $password=Require-Env "TOBACCO_SYNC_PASSWORD"
$session=Get-Session $url $key $email $password; $h=Headers $key $session.access_token

while($true){
  try {
    # RLS means this dedicated user can only see requests it owns. Server-side dispatch
    # to this worker is added through the trusted broker in the next layer.
    $uri="$url/rest/v1/ameen_read_requests?status=eq.pending&expires_at=gt.$([uri]::EscapeDataString((Get-Date).ToUniversalTime().ToString('o')))&order=requested_at.asc&limit=1"
    $jobs=@(Invoke-RestMethod -Method Get -Uri $uri -Headers $h)
    foreach($job in $jobs){
      $id=[string]$job.id
      try {
        $result=& "$PSScriptRoot\ameen-read-gateway.ps1" -Resource ([string]$job.resource) | ConvertFrom-Json
        $body=@{status='completed';completed_at=(Get-Date).ToUniversalTime().ToString('o');response=$result;agent_id=$AgentId}|ConvertTo-Json -Depth 30
        Invoke-RestMethod -Method Patch -Uri "$url/rest/v1/ameen_read_requests?id=eq.$id" -Headers ($h+@{Prefer='return=minimal'}) -ContentType 'application/json' -Body $body | Out-Null
      } catch {
        $body=@{status='failed';completed_at=(Get-Date).ToUniversalTime().ToString('o');error=$_.Exception.Message;agent_id=$AgentId}|ConvertTo-Json
        Invoke-RestMethod -Method Patch -Uri "$url/rest/v1/ameen_read_requests?id=eq.$id" -Headers ($h+@{Prefer='return=minimal'}) -ContentType 'application/json' -Body $body | Out-Null
      }
    }
  } catch { Write-Warning ("Ameen read worker: "+$_.Exception.Message) }
  Start-Sleep -Seconds ([math]::Max(2,$PollSeconds))
}
