param(
  [string]$AgentRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path,
  [string]$BuildSha = ""
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
if (-not (Test-Path -LiteralPath $packageJsonPath)) { throw "package.json not found: $packageJsonPath" }
$packageJson = Get-Content -LiteralPath $packageJsonPath -Raw | ConvertFrom-Json
$startCommand = [string]$packageJson.scripts.start

if ($startCommand -match '(?:^|\s)tsx(?:\.cmd)?\s+src[/\\]index\.ts(?:\s|$)') {
  $runtimeMode = "source"
  $entry = "src/index.ts"
} elseif ($startCommand -match '(?:^|\s)node(?:\.exe)?\s+dist[/\\]index\.js(?:\s|$)') {
  $runtimeMode = "dist"
  $entry = "dist/index.js"
} else {
  throw "Unsupported Windows agent scripts.start command: $startCommand"
}

if (-not $BuildSha) { $BuildSha = [string]$env:BG_COMPANY_BUILD_SHA }
if (-not $BuildSha) { $BuildSha = [string]$env:NAVER_AGENT_BUILD_SHA }
if (-not $BuildSha -and (Get-Command git.exe -ErrorAction SilentlyContinue)) {
  $BuildSha = (& git.exe -C $resolvedAgentRoot rev-parse HEAD 2>$null | Select-Object -First 1).Trim()
}
if ($BuildSha -notmatch '^[0-9a-fA-F]{7,64}$') {
  throw "A reviewed Git build SHA is required. Pass -BuildSha or set BG_COMPANY_BUILD_SHA."
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

$files = foreach ($relativePath in $relativeFiles) {
  $fullPath = Join-Path $resolvedAgentRoot $relativePath.Replace("/", "\")
  if (-not (Test-Path -LiteralPath $fullPath -PathType Leaf)) { throw "Runtime file missing: $relativePath" }
  [ordered]@{ path = $relativePath; sha256 = (Get-FileHash -LiteralPath $fullPath -Algorithm SHA256).Hash.ToLowerInvariant() }
}
$fingerprintText = (($files | ForEach-Object { "$($_.path):$($_.sha256)" }) -join "`n")
$sha256 = [System.Security.Cryptography.SHA256]::Create()
try {
  $aggregateHash = ([BitConverter]::ToString($sha256.ComputeHash([Text.Encoding]::UTF8.GetBytes($fingerprintText)))).Replace("-", "").ToLowerInvariant()
} finally {
  $sha256.Dispose()
}

$manifest = [ordered]@{
  schemaVersion = 1
  generatedAt = (Get-Date).ToUniversalTime().ToString("o")
  buildSha = $BuildSha.ToLowerInvariant()
  runtimeMode = $runtimeMode
  entry = $entry
  aggregateSha256 = $aggregateHash
  files = @($files)
}
$manifestPath = Join-Path $resolvedAgentRoot "runtime-manifest.json"
$temporaryPath = "$manifestPath.$PID.tmp"
$manifestJson = $manifest | ConvertTo-Json -Depth 5
[System.IO.File]::WriteAllText(
  $temporaryPath,
  $manifestJson,
  [System.Text.UTF8Encoding]::new($false)
)
Move-Item -LiteralPath $temporaryPath -Destination $manifestPath -Force
Write-Host "Wrote reviewed runtime manifest: $manifestPath"
Write-Host "Runtime SHA256: $aggregateHash"

