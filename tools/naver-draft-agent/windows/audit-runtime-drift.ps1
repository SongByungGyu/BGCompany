param(
  [string]$AgentRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
)

$ErrorActionPreference = "Stop"
$resolvedAgentRoot = (Resolve-Path -LiteralPath $AgentRoot).Path.TrimEnd("\")
function Get-RuntimeTreeFiles {
  param([string]$Directory, [string]$RelativeDirectory, [ValidateSet("source", "dist")][string]$Mode)
  $result = @()
  foreach ($item in @(Get-ChildItem -LiteralPath $Directory -Force)) {
    $relativePath = "$RelativeDirectory/$($item.Name)"
    if ($item.PSIsContainer) {
      $result += @(Get-RuntimeTreeFiles -Directory $item.FullName -RelativeDirectory $relativePath -Mode $Mode)
    } elseif ($Mode -eq "source" -and $item.Extension -eq ".ts" -and $item.Name -notlike "*.test.ts") {
      $result += $relativePath
    } elseif ($Mode -eq "dist" -and $item.Extension -in @(".js", ".json", ".map") -and $item.Name -ne "runtime-manifest.json") {
      $result += $relativePath
    }
  }
  return $result
}
$packageJsonPath = Join-Path $resolvedAgentRoot "package.json"
$manifestPath = Join-Path $resolvedAgentRoot "runtime-manifest.json"
if (-not (Test-Path -LiteralPath $packageJsonPath)) { throw "package.json not found: $packageJsonPath" }
if (-not (Test-Path -LiteralPath $manifestPath)) { throw "Reviewed runtime manifest not found: $manifestPath" }

$packageJson = Get-Content -LiteralPath $packageJsonPath -Raw | ConvertFrom-Json
$manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
$startCommand = [string]$packageJson.scripts.start
if ($startCommand -match '(?:^|\s)tsx(?:\.cmd)?\s+src[/\\]index\.ts(?:\s|$)') {
  $runtimeMode = "source"
  $entry = "src/index.ts"
  $tsxCommand = Join-Path $resolvedAgentRoot "node_modules\.bin\tsx.cmd"
  $tsxPackage = Join-Path $resolvedAgentRoot "node_modules\tsx\package.json"
  if (-not (Test-Path -LiteralPath $tsxCommand -PathType Leaf)) { throw "Reviewed source runtime requires local tsx.cmd: $tsxCommand" }
  if (-not (Test-Path -LiteralPath $tsxPackage -PathType Leaf)) { throw "Reviewed source runtime requires the local tsx package." }
} elseif ($startCommand -match '(?:^|\s)node(?:\.exe)?\s+dist[/\\]index\.js(?:\s|$)') {
  $runtimeMode = "dist"
  $entry = "dist/index.js"
} else {
  throw "Unsupported Windows agent scripts.start command: $startCommand"
}

if ($manifest.schemaVersion -ne 1) { throw "Unsupported runtime manifest schema." }
if ([string]$manifest.buildSha -notmatch '^[0-9a-fA-F]{7,64}$') { throw "Runtime manifest buildSha is invalid." }
if ([string]$manifest.runtimeMode -ne $runtimeMode -or [string]$manifest.entry -ne $entry) {
  throw "Runtime manifest mode/entry does not match package.json scripts.start."
}

$relativeFiles = @("package.json", "package-lock.json", "tsconfig.json", "node_modules/playwright/package.json")
$relativeFiles += @(Get-ChildItem -LiteralPath (Join-Path $resolvedAgentRoot "windows") -File -Filter "*.ps1" |
  ForEach-Object { "windows/$($_.Name)" })
if ($runtimeMode -eq "source") {
  $relativeFiles += @("node_modules/.bin/tsx.cmd", "node_modules/tsx/package.json")
  $relativeFiles += @(Get-RuntimeTreeFiles -Directory (Join-Path $resolvedAgentRoot "src") -RelativeDirectory "src" -Mode "source")
} else {
  $relativeFiles += @(Get-RuntimeTreeFiles -Directory (Join-Path $resolvedAgentRoot "dist") -RelativeDirectory "dist" -Mode "dist")
}
$relativeFiles = @($relativeFiles | Sort-Object -Unique)
$manifestFiles = @($manifest.files | ForEach-Object { [string]$_.path } | Sort-Object -Unique)
$missingFromManifest = @($relativeFiles | Where-Object { $_ -notin $manifestFiles })
$missingFromRuntime = @($manifestFiles | Where-Object { $_ -notin $relativeFiles })
if ($missingFromManifest.Count -gt 0 -or $missingFromRuntime.Count -gt 0) {
  throw "Runtime manifest file set mismatch. unmanifested=$($missingFromManifest -join ',') missing=$($missingFromRuntime -join ',')"
}

$files = foreach ($relativePath in $relativeFiles) {
  $fullPath = Join-Path $resolvedAgentRoot $relativePath.Replace("/", "\")
  $actualHash = (Get-FileHash -LiteralPath $fullPath -Algorithm SHA256).Hash.ToLowerInvariant()
  $expected = $manifest.files | Where-Object { [string]$_.path -eq $relativePath } | Select-Object -First 1
  if (-not $expected -or [string]$expected.sha256 -ne $actualHash) {
    throw "Runtime SHA mismatch: $relativePath"
  }
  [ordered]@{ path = $relativePath; sha256 = $actualHash }
}
$fingerprintText = (($files | ForEach-Object { "$($_.path):$($_.sha256)" }) -join "`n")
$sha256 = [System.Security.Cryptography.SHA256]::Create()
try {
  $aggregateHash = ([BitConverter]::ToString($sha256.ComputeHash([Text.Encoding]::UTF8.GetBytes($fingerprintText)))).Replace("-", "").ToLowerInvariant()
} finally {
  $sha256.Dispose()
}
if ([string]$manifest.aggregateSha256 -ne $aggregateHash) { throw "Runtime aggregate SHA mismatch." }

[pscustomobject]@{
  BuildSha = [string]$manifest.buildSha
  RuntimeSha256 = $aggregateHash
  RuntimeMode = $runtimeMode
  Entry = $entry
}

