Param(
  [string]$Mode = "default"
)

$ErrorActionPreference = "Stop"
node scripts/smokePhase4DriverAdmin.js
