[CmdletBinding()]
param(
  [string]$Severity = "SEV-3",
  [string]$Title = ""
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectRoot = Resolve-Path (Join-Path $scriptDir "..")

$templatePath = Join-Path $projectRoot "INCIDENT_TEMPLATE.md"
if (-not (Test-Path -LiteralPath $templatePath)) {
  throw "Template not found: $templatePath"
}

$incidentsDir = Join-Path $projectRoot "incidents"
if (-not (Test-Path -LiteralPath $incidentsDir)) {
  New-Item -ItemType Directory -Path $incidentsDir | Out-Null
}

$now = Get-Date
$datePart = $now.ToString("yyyyMMdd-HHmmss")
$safeTitle = $Title.Trim()
if ($safeTitle) {
  $safeTitle = ($safeTitle -replace "[^a-zA-Z0-9\-_\s]", "").Trim() -replace "\s+", "-"
}

$fileName = if ($safeTitle) { "incident-$datePart-$safeTitle.md" } else { "incident-$datePart.md" }
$targetPath = Join-Path $incidentsDir $fileName

$header = @(
  "# Incident Report",
  "",
  "- Created: $($now.ToString("yyyy-MM-dd HH:mm:ss zzz"))",
  "- Severity: $Severity",
  "- Status: open",
  "",
  "---",
  ""
) -join "`r`n"

$template = Get-Content -LiteralPath $templatePath -Raw
Set-Content -LiteralPath $targetPath -Value ($header + $template) -Encoding UTF8

Write-Host "Created incident file:"
Write-Host $targetPath -ForegroundColor Green
