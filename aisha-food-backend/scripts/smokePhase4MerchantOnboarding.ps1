Param(
  [string]$Mode = "default"
)

$ErrorActionPreference = "Stop"
node scripts/smokePhase4MerchantOnboarding.js
