param([string]$OwnerAccount)
$ErrorActionPreference = 'Stop'
$taskRoot = Split-Path -Parent $PSScriptRoot
$taskKey = Join-Path $taskRoot '.vendor\license-private-key.pem'
if (-not (Test-Path -LiteralPath $taskKey -PathType Leaf)) { throw 'Vendor key is missing' }
$taskCaller = [Security.Principal.WindowsIdentity]::GetCurrent().Name
if (-not $OwnerAccount) { $OwnerAccount = $taskCaller }
$taskAcl = Get-Acl -LiteralPath $taskKey
$taskAcl.SetAccessRuleProtection($true, $false)
foreach ($taskAccount in @($taskCaller, $OwnerAccount, 'NT AUTHORITY\SYSTEM', 'BUILTIN\Administrators') | Select-Object -Unique) {
  $taskRule = [Security.AccessControl.FileSystemAccessRule]::new($taskAccount, 'FullControl', 'Allow')
  $taskAcl.AddAccessRule($taskRule)
}
Set-Acl -LiteralPath $taskKey -AclObject $taskAcl
Write-Output 'Vendor key inheritance removed; access limited to owner, issuer, SYSTEM and administrators.'
