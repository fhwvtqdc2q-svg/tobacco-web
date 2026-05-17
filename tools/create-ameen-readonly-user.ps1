param(
  [string]$Server = "OZK-TOBACCO",
  [string]$Database = "AmnDb001",
  [string]$AdminUserName = "sa",
  [string]$SyncUserName = "tobacco_sync_reader"
)

$ErrorActionPreference = "Stop"

function Convert-SecureStringToPlainText($SecureValue) {
  $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($SecureValue)
  try {
    return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
  } finally {
    if ($bstr -ne [IntPtr]::Zero) {
      [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
    }
  }
}

function Escape-SqlString($Value) {
  return ([string]$Value).Replace("'", "''")
}

function Read-StrongPassword($Prompt, $MinimumLength) {
  while ($true) {
    $securePassword = Read-Host $Prompt -AsSecureString
    $plainPassword = Convert-SecureStringToPlainText $securePassword

    if ($plainPassword.Length -ge $MinimumLength) {
      Remove-Variable plainPassword -ErrorAction SilentlyContinue
      return $securePassword
    }

    Write-Host "Password is too short. Type at least $MinimumLength characters."
    Remove-Variable plainPassword -ErrorAction SilentlyContinue
  }
}

function New-SqlConnectionString($Server, $Database, $UserName, $Password) {
  $builder = New-Object System.Data.SqlClient.SqlConnectionStringBuilder
  $builder["Data Source"] = $Server
  $builder["Initial Catalog"] = $Database
  $builder["User ID"] = $UserName
  $builder["Password"] = $Password
  $builder["TrustServerCertificate"] = $true
  $builder["Connect Timeout"] = 10
  return $builder.ConnectionString
}

function Invoke-NonQuery($ConnectionString, $CommandText) {
  $connection = New-Object System.Data.SqlClient.SqlConnection $ConnectionString
  try {
    $connection.Open()
    $command = $connection.CreateCommand()
    $command.CommandTimeout = 60
    $command.CommandText = $CommandText
    [void]$command.ExecuteNonQuery()
  } finally {
    if ($connection.State -eq "Open") {
      $connection.Close()
    }
  }
}

function Invoke-Scalar($ConnectionString, $CommandText) {
  $connection = New-Object System.Data.SqlClient.SqlConnection $ConnectionString
  try {
    $connection.Open()
    $command = $connection.CreateCommand()
    $command.CommandTimeout = 30
    $command.CommandText = $CommandText
    return $command.ExecuteScalar()
  } finally {
    if ($connection.State -eq "Open") {
      $connection.Close()
    }
  }
}

Add-Type -AssemblyName System.Data

$adminSecurePassword = Read-Host "SQL admin password for $AdminUserName on $Server" -AsSecureString
$syncSecurePassword = Read-StrongPassword -Prompt "New password for read-only SQL user $SyncUserName" -MinimumLength 12
$syncConfirmPassword = Read-Host "Confirm new password for $SyncUserName" -AsSecureString

$adminPassword = $null
$syncPassword = $null
$syncConfirm = $null

try {
  $adminPassword = Convert-SecureStringToPlainText $adminSecurePassword
  $syncPassword = Convert-SecureStringToPlainText $syncSecurePassword
  $syncConfirm = Convert-SecureStringToPlainText $syncConfirmPassword

  if ($syncPassword -ne $syncConfirm) {
    throw "The read-only user passwords do not match."
  }

  $masterConnectionString = New-SqlConnectionString -Server $Server -Database "master" -UserName $AdminUserName -Password $adminPassword
  $login = Escape-SqlString $SyncUserName
  $db = Escape-SqlString $Database
  $password = Escape-SqlString $syncPassword

  $sql = @"
declare @login sysname = N'$login';
declare @db sysname = N'$db';
declare @password nvarchar(256) = N'$password';
declare @sql nvarchar(max);

if not exists (select 1 from sys.sql_logins where name = @login)
begin
  set @sql = N'create login ' + quotename(@login) + N' with password = N''' + replace(@password, '''', '''''') + N''', check_policy = on, check_expiration = off';
  exec(@sql);
end
else
begin
  set @sql = N'alter login ' + quotename(@login) + N' with password = N''' + replace(@password, '''', '''''') + N''', check_policy = on, check_expiration = off';
  exec(@sql);

  set @sql = N'alter login ' + quotename(@login) + N' enable';
  exec(@sql);
end

set @sql = N'use ' + quotename(@db) + N';
if not exists (select 1 from sys.database_principals where name = N''' + replace(@login, '''', '''''') + N''')
begin
  create user ' + quotename(@login) + N' for login ' + quotename(@login) + N';
end;

if not exists (
  select 1
  from sys.database_role_members drm
  join sys.database_principals r on r.principal_id = drm.role_principal_id
  join sys.database_principals m on m.principal_id = drm.member_principal_id
  where r.name = N''db_datareader''
    and m.name = N''' + replace(@login, '''', '''''') + N'''
)
begin
  exec sp_addrolemember N''db_datareader'', N''' + replace(@login, '''', '''''') + N''';
end;';
exec(@sql);
"@

  Invoke-NonQuery -ConnectionString $masterConnectionString -CommandText $sql

  $readerConnectionString = New-SqlConnectionString -Server $Server -Database $Database -UserName $SyncUserName -Password $syncPassword
  $itemCount = Invoke-Scalar -ConnectionString $readerConnectionString -CommandText "select count_big(*) from dbo.mt000;"

  Write-Host "Read-only SQL user is ready: $SyncUserName"
  Write-Host "Verified read access to $Database.dbo.mt000. Rows: $itemCount"
  Write-Host "Do not send or paste the password in chat."
} finally {
  Remove-Variable adminPassword -ErrorAction SilentlyContinue
  Remove-Variable syncPassword -ErrorAction SilentlyContinue
  Remove-Variable syncConfirm -ErrorAction SilentlyContinue
}
