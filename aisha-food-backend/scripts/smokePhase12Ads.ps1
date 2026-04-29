Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

node scripts/smokePhase12Ads.js
if ($LASTEXITCODE -ne 0) {
  exit $LASTEXITCODE
}
