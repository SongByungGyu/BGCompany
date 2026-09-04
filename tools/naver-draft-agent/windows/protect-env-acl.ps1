param(
  [string]$AgentRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
)

$ErrorActionPreference = "Stop"
$resolvedAgentRoot = (Resolve-Path -LiteralPath $AgentRoot).Path.TrimEnd("\")
if (-not [IO.Path]::IsPathRooted($resolvedAgentRoot) -or $resolvedAgentRoot -eq [IO.Path]::GetPathRoot($resolvedAgentRoot)) {
  throw "Unsafe AgentRoot for ACL hardening: $resolvedAgentRoot"
}
if (-not (Test-Path -LiteralPath (Join-Path $resolvedAgentRoot "package.json") -PathType Leaf)) {
  throw "Refusing ACL change outside an agent runtime: $resolvedAgentRoot"
}
if (-not (Test-Path -LiteralPath (Join-Path $resolvedAgentRoot ".env") -PathType Leaf)) {
  throw ".env not found in $resolvedAgentRoot"
}

$currentUser = [System.Security.Principal.WindowsIdentity]::GetCurrent().User
$systemSid = [System.Security.Principal.SecurityIdentifier]::new("S-1-5-18")
$administratorsSid = [System.Security.Principal.SecurityIdentifier]::new("S-1-5-32-544")

function Set-RestrictedAcl {
  param([Parameter(Mandatory = $true)][string]$Path, [Parameter(Mandatory = $true)][bool]$IsDirectory)
  $fullPath = [IO.Path]::GetFullPath($Path)
  if ($fullPath -ne $resolvedAgentRoot -and -not $fullPath.StartsWith("$resolvedAgentRoot\", [StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing ACL change outside AgentRoot: $fullPath"
  }
  $acl = if ($IsDirectory) {
    [System.Security.AccessControl.DirectorySecurity]::new()
  } else {
    [System.Security.AccessControl.FileSecurity]::new()
  }
  $acl.SetAccessRuleProtection($true, $false)
  foreach ($sid in @($currentUser, $systemSid, $administratorsSid)) {
    $rule = if ($IsDirectory) {
      [System.Security.AccessControl.FileSystemAccessRule]::new(
        $sid,
        [System.Security.AccessControl.FileSystemRights]::FullControl,
        [System.Security.AccessControl.InheritanceFlags]::ContainerInherit -bor [System.Security.AccessControl.InheritanceFlags]::ObjectInherit,
        [System.Security.AccessControl.PropagationFlags]::None,
        [System.Security.AccessControl.AccessControlType]::Allow
      )
    } else {
      [System.Security.AccessControl.FileSystemAccessRule]::new(
        $sid,
        [System.Security.AccessControl.FileSystemRights]::FullControl,
        [System.Security.AccessControl.AccessControlType]::Allow
      )
    }
    [void]$acl.AddAccessRule($rule)
  }
  $aclExtensionsType = "System.IO.FileSystemAclExtensions" -as [type]
  if ($aclExtensionsType) {
    $item = if ($IsDirectory) { [IO.DirectoryInfo]::new($fullPath) } else { [IO.FileInfo]::new($fullPath) }
    $securityType = if ($IsDirectory) {
      [System.Security.AccessControl.DirectorySecurity]
    } else {
      [System.Security.AccessControl.FileSecurity]
    }
    $itemType = if ($IsDirectory) { [IO.DirectoryInfo] } else { [IO.FileInfo] }
    $setAccessControl = $aclExtensionsType.GetMethod("SetAccessControl", [type[]]@($itemType, $securityType))
    if (-not $setAccessControl) { throw "Access-only ACL API was not found for $fullPath" }
    [void]$setAccessControl.Invoke($null, [object[]]@($item, $acl))
  } elseif ($IsDirectory) {
    [IO.Directory]::SetAccessControl($fullPath, $acl)
  } else {
    [IO.File]::SetAccessControl($fullPath, $acl)
  }
}

Set-RestrictedAcl -Path $resolvedAgentRoot -IsDirectory $true
foreach ($target in Get-ChildItem -LiteralPath $resolvedAgentRoot -Force -Recurse) {
  if (($target.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
    throw "Refusing to traverse runtime reparse point: $($target.FullName)"
  }
  Set-RestrictedAcl -Path $target.FullName -IsDirectory $target.PSIsContainer
}
Write-Host "Hardened runtime ACL for current user, SYSTEM, and Administrators: $resolvedAgentRoot"
