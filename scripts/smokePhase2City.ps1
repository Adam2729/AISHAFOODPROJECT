[CmdletBinding()]
param(
  [string]$BaseUrl = "http://localhost:3000",
  [ValidateSet("auto", "enabled", "disabled", "enabled-flip")]
  [string]$Mode = "auto",
  [switch]$SkipHealthCheck
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Get-EnvVarValueFromFile {
  param(
    [Parameter(Mandatory = $true)][string]$FilePath,
    [Parameter(Mandatory = $true)][string]$Name
  )

  if (-not (Test-Path -LiteralPath $FilePath)) {
    return $null
  }

  foreach ($line in Get-Content -LiteralPath $FilePath) {
    $trimmed = $line.Trim()
    if ([string]::IsNullOrWhiteSpace($trimmed) -or $trimmed.StartsWith("#")) {
      continue
    }

    $pattern = "^\s*$Name\s*=\s*(.+)\s*$"
    if ($trimmed -notmatch $pattern) {
      continue
    }

    $value = $matches[1].Trim()
    if (
      ($value.StartsWith('"') -and $value.EndsWith('"')) -or
      ($value.StartsWith("'") -and $value.EndsWith("'"))
    ) {
      $value = $value.Substring(1, $value.Length - 2)
    }

    return $value
  }

  return $null
}

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectRoot = Resolve-Path (Join-Path $scriptDir "..")
Set-Location $projectRoot

$normalizedBase = $BaseUrl.TrimEnd("/")
$env:SMOKE_BASE_URL = $normalizedBase

if (-not $env:ADMIN_KEY) {
  $fromLocal = Get-EnvVarValueFromFile -FilePath (Join-Path $projectRoot ".env.local") -Name "ADMIN_KEY"
  if ($fromLocal) {
    $env:ADMIN_KEY = $fromLocal
  }
}

if (-not $env:ADMIN_KEY) {
  $fromEnv = Get-EnvVarValueFromFile -FilePath (Join-Path $projectRoot ".env") -Name "ADMIN_KEY"
  if ($fromEnv) {
    $env:ADMIN_KEY = $fromEnv
  }
}

if (-not $env:ADMIN_KEY) {
  throw "ADMIN_KEY not found in environment, .env.local, or .env."
}

if (-not $SkipHealthCheck -and $Mode -ne "enabled-flip") {
  try {
    $null = Invoke-RestMethod -Method Get -Uri "$normalizedBase/api/health" -TimeoutSec 10
  } catch {
    throw "Backend not reachable at $normalizedBase. Start backend first with: npm run dev"
  }
}

Write-Host "Running Phase-2 city smoke against $normalizedBase (mode=$Mode) ..." -ForegroundColor Cyan
& node scripts/smokePhase2City.js "--mode=$Mode"
if ($LASTEXITCODE -ne 0) {
  exit $LASTEXITCODE
}

Write-Host "Phase-2 city smoke completed successfully." -ForegroundColor Green
