Param(
  [string]$Mode = "default"
)

$ErrorActionPreference = "Stop"
node scripts/smokePhase4DriverOnboarding.js
