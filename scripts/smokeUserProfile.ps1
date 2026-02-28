[CmdletBinding()]
param(
  [string]$BaseUrl = "http://localhost:3000",
  [switch]$SkipHealthCheck
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectRoot = Resolve-Path (Join-Path $scriptDir "..")
Set-Location $projectRoot

$normalizedBase = $BaseUrl.TrimEnd("/")
$env:SMOKE_BASE_URL = $normalizedBase

if (-not $SkipHealthCheck) {
  try {
    $null = Invoke-RestMethod -Method Get -Uri "$normalizedBase/api/health" -TimeoutSec 10
  } catch {
    throw "Backend not reachable at $normalizedBase. Start backend first with: npm run dev"
  }
}

Write-Host "Running user profile smoke against $normalizedBase ..." -ForegroundColor Cyan
& npm run qa:smoke:user-profile
if ($LASTEXITCODE -ne 0) {
  exit $LASTEXITCODE
}

Write-Host "User profile smoke completed successfully." -ForegroundColor Green
