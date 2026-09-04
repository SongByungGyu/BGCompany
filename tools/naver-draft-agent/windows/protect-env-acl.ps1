param(
  [string]$AgentRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
)

$ErrorActionPreference = "Stop"
$resolvedAgentRoot = (Resolve-Path -LiteralPath $AgentRoot).Path.TrimEnd("\")
$allowedName = '^\.env(?:\.bak|\.before-[A-Za-z0-9._-]+)?$'
$targets = @(Get-ChildItem -LiteralPath $resolvedAgentRoot -File -Force |
  Where-Object { $_.Name -match $allowedName })
if (-not ($targets | Where-Object { $_.Name -eq ".env" })) { throw ".env not found in $resolvedAgentRoot" }

$currentUser = [System.Security.Principal.WindowsIdentity]::GetCurrent().User
$systemSid = [System.Security.Principal.SecurityIdentifier]::new("S-1-5-18")
$administratorsSid = [System.Security.Principal.SecurityIdentifier]::new("S-1-5-32-544")
foreach ($target in $targets) {
  if ($target.DirectoryName.TrimEnd("\") -ne $resolvedAgentRoot) { throw "Refusing ACL change outside AgentRoot: $($target.FullName)" }
  $acl = [System.Security.AccessControl.FileSecurity]::new()
  $acl.SetOwner($currentUser)
  $acl.SetAccessRuleProtection($true, $false)
  foreach ($sid in @($currentUser, $systemSid, $administratorsSid)) {
    $rule = [System.Security.AccessControl.FileSystemAccessRule]::new(
      $sid,
      [System.Security.AccessControl.FileSystemRights]::FullControl,
      [System.Security.AccessControl.AccessControlType]::Allow
    )
    [void]$acl.AddAccessRule($rule)
  }
  Set-Acl -LiteralPath $target.FullName -AclObject $acl
  Write-Host "Hardened ACL: $($target.Name)"
}


