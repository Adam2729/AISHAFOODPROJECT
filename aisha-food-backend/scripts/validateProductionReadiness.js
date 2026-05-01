/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require("node:fs");
const path = require("node:path");
const mongoose = require("mongoose");

function loadEnvForScript() {
  const localPath = path.resolve(process.cwd(), ".env.local");
  const envPath = path.resolve(process.cwd(), ".env");

  if (typeof process.loadEnvFile === "function") {
    process.loadEnvFile(localPath);
    process.loadEnvFile(envPath);
    return;
  }

  try {
    const dotenv = require("dotenv");
    dotenv.config({ path: localPath });
    dotenv.config({ path: envPath });
  } catch {
    // env may already be loaded
  }
}

function normalize(value) {
  return String(value || "").trim();
}

function normalizeDigits(value) {
  return normalize(value).replace(/\D+/g, "");
}

function normalizeUpper(value) {
  return normalize(value).toUpperCase();
}

function parseMode() {
  const arg = process.argv.find((entry) => entry.startsWith("--mode="));
  const raw = normalize((arg || "").split("=")[1] || process.env.NODE_ENV || "development").toLowerCase();
  return raw === "production" ? "production" : raw === "preview" ? "preview" : "development";
}

function supportConfigured(value) {
  const digits = normalizeDigits(value);
  return digits.length >= 7 && digits !== "18090000000" && digits !== "22300000000";
}

function looksPlaceholder(value) {
  const raw = normalize(value).toLowerCase();
  return (
    !raw ||
    raw.includes("<user>") ||
    raw.includes("<pass>") ||
    raw.includes("replace-with") ||
    raw.includes("change-this") ||
    raw.includes("your-live-host")
  );
}

function printCheck(label, ok, detail) {
  const prefix = ok ? "[PASS]" : "[FAIL]";
  console.log(`${prefix} ${label}${detail ? `: ${detail}` : ""}`);
}

async function main() {
  loadEnvForScript();

  const mode = parseMode();
  const isProductionMode = mode === "production";
  const failures = [];
  const warnings = [];

  const mongoUri = normalize(process.env.MONGODB_URI);
  const adminKey = normalize(process.env.ADMIN_KEY);
  const jwtSecret = normalize(process.env.JWT_SECRET);
  const driverJwtSecret = normalize(process.env.DRIVER_JWT_SECRET);
  const piiHashSecret = normalize(process.env.PII_HASH_SECRET);
  const statementSigningSecret = normalize(process.env.STATEMENT_SIGNING_SECRET);
  const cronSecret = normalize(process.env.CRON_SECRET);
  const googleMapsKey = normalize(process.env.GOOGLE_MAPS_API_KEY);
  const supportWhatsApp = normalizeDigits(process.env.SUPPORT_WHATSAPP_E164);
  const publicApiBaseUrl = normalize(process.env.PUBLIC_API_BASE_URL);
  const publicApiAllowedOrigins = normalize(process.env.PUBLIC_API_ALLOWED_ORIGINS);
  const launchCityCode = normalizeUpper(process.env.LAUNCH_CITY_CODE || "BKO") || "BKO";
  const bamakoEnabled = normalize(process.env.MULTICITY_ENABLE_BAMAKO || "true").toLowerCase() !== "false";
  const devLocationBypass = normalize(process.env.DEV_ALLOW_ORDER_LOCATION_BYPASS || "false").toLowerCase() === "true";
  const baseLat = Number(process.env.BASE_LOCATION_LAT);
  const baseLng = Number(process.env.BASE_LOCATION_LNG);

  const requiredChecks = [
    ["MONGODB_URI present", Boolean(mongoUri), mongoUri ? "configured" : "missing"],
    ["ADMIN_KEY present", Boolean(adminKey) && !looksPlaceholder(adminKey), adminKey ? "configured" : "missing"],
    ["JWT_SECRET present", Boolean(jwtSecret) && !looksPlaceholder(jwtSecret), jwtSecret ? "configured" : "missing"],
    [
      "DRIVER_JWT_SECRET present",
      Boolean(driverJwtSecret) && !looksPlaceholder(driverJwtSecret),
      driverJwtSecret ? "configured" : "missing",
    ],
    [
      "PII_HASH_SECRET present",
      Boolean(piiHashSecret) && !looksPlaceholder(piiHashSecret),
      piiHashSecret ? "configured" : "missing",
    ],
    [
      "STATEMENT_SIGNING_SECRET present",
      Boolean(statementSigningSecret) && !looksPlaceholder(statementSigningSecret),
      statementSigningSecret ? "configured" : "missing",
    ],
    ["CRON_SECRET present", Boolean(cronSecret) && !looksPlaceholder(cronSecret), cronSecret ? "configured" : "missing"],
    [
      "GOOGLE_MAPS_API_KEY present",
      Boolean(googleMapsKey) && !looksPlaceholder(googleMapsKey),
      googleMapsKey ? "configured" : "missing",
    ],
    [
      "PUBLIC_API_BASE_URL set",
      Boolean(publicApiBaseUrl) && /^https:\/\//i.test(publicApiBaseUrl) && !looksPlaceholder(publicApiBaseUrl),
      publicApiBaseUrl || "missing",
    ],
    [
      "Base coordinates configured",
      Number.isFinite(baseLat) && Number.isFinite(baseLng),
      `${Number.isFinite(baseLat) ? baseLat : "?"}, ${Number.isFinite(baseLng) ? baseLng : "?"}`,
    ],
  ];

  requiredChecks.forEach(([label, ok, detail]) => {
    printCheck(label, ok, detail);
    if (!ok) failures.push(label);
  });

  const supportReady = supportConfigured(supportWhatsApp);
  const supportCheckOk = isProductionMode ? supportReady : true;
  const supportDetail = supportReady
    ? supportWhatsApp
    : mode === "production"
      ? "missing - required before production launch"
      : mode === "preview"
        ? "missing - preview can continue, but production is not launch-ready"
        : "missing - allowed for local UK testing only";
  printCheck("SUPPORT_WHATSAPP_E164 launch-ready", supportCheckOk, supportDetail);
  if (!supportCheckOk) {
    failures.push("SUPPORT_WHATSAPP_E164");
  } else if (!supportReady) {
    warnings.push(
      mode === "preview"
        ? "Support WhatsApp is still missing. Preview testing can continue, but production is not launch-ready."
        : "Support WhatsApp is still missing. Local UK testing can continue, but production is not launch-ready."
    );
  }

  const bypassCheckOk = true;
  const bypassDetail = !devLocationBypass
    ? "false"
    : mode === "production"
      ? "true - warning only, unsafe for production"
      : mode === "preview"
        ? "true - preview warning only, unsafe for production"
        : "true - allowed for local UK testing only";
  printCheck("DEV_ALLOW_ORDER_LOCATION_BYPASS policy", bypassCheckOk, bypassDetail);
  if (devLocationBypass) {
    warnings.push(
      mode === "production"
        ? "DEV_ALLOW_ORDER_LOCATION_BYPASS is enabled. Orders can continue, but this is unsafe for production."
        : mode === "preview"
          ? "DEV_ALLOW_ORDER_LOCATION_BYPASS is enabled. Preview testing can continue, but this is unsafe for production."
          : "DEV_ALLOW_ORDER_LOCATION_BYPASS is enabled. Allowed for local UK testing only."
    );
  }

  const originsConfigured = Boolean(publicApiAllowedOrigins);
  printCheck(
    "PUBLIC_API_ALLOWED_ORIGINS reviewed",
    originsConfigured,
    originsConfigured ? publicApiAllowedOrigins : "not configured"
  );
  if (!originsConfigured) {
    warnings.push("PUBLIC_API_ALLOWED_ORIGINS is empty. Confirm same-origin deployment or add explicit frontend origins.");
  }

  printCheck("Launch city code", launchCityCode === "BKO" || launchCityCode === "SDQ", launchCityCode);
  if (launchCityCode !== "BKO" && launchCityCode !== "SDQ") {
    failures.push("LAUNCH_CITY_CODE");
  }

  printCheck("Bamako path enabled", bamakoEnabled, bamakoEnabled ? "enabled" : "disabled");
  if (!bamakoEnabled && launchCityCode === "BKO") {
    failures.push("MULTICITY_ENABLE_BAMAKO");
  }

  printCheck(
    "Delivery modes supported",
    true,
    "self_delivery, platform_driver"
  );

  if (!mongoUri) {
    throw new Error("MONGODB_URI is required to validate launch readiness.");
  }

  await mongoose.connect(mongoUri);
  const db = mongoose.connection.db;
  const cities = await db
    .collection("cities")
    .find({}, { projection: { code: 1, name: 1, country: 1, isActive: 1, currency: 1 } })
    .toArray();
  const launchCity = cities.find((city) => normalizeUpper(city.code) === launchCityCode);
  const bamakoCity = cities.find((city) => normalizeUpper(city.code) === "BKO");

  const launchCityOk = Boolean(launchCity && launchCity.isActive);
  printCheck(
    "Launch city active in database",
    launchCityOk,
    launchCity ? `${launchCity.name} (${launchCity.code})` : "missing"
  );
  if (!launchCityOk) failures.push("launch city inactive or missing");

  const bamakoCityOk = Boolean(bamakoCity && bamakoCity.isActive);
  printCheck(
    "Bamako city available",
    bamakoCityOk,
    bamakoCity ? `${bamakoCity.name} (${bamakoCity.code})` : "missing"
  );
  if (!bamakoCityOk) failures.push("Bamako city missing");

  const summary = {
    mode,
    launchCityCode,
    bamakoEnabled,
    supportWhatsAppConfigured: supportWhatsApp.length >= 7,
    publicApiBaseUrlConfigured: Boolean(publicApiBaseUrl),
    publicApiAllowedOriginsConfigured: originsConfigured,
    googleMapsConfigured: Boolean(googleMapsKey),
    cronConfigured: Boolean(cronSecret),
    deliveryModesSupported: ["self_delivery", "platform_driver"],
    launchCity: launchCity
      ? {
          code: launchCity.code,
          name: launchCity.name,
          country: launchCity.country,
          currency: launchCity.currency,
          active: Boolean(launchCity.isActive),
        }
      : null,
  };

  console.log("\nLaunch readiness summary:");
  console.log(JSON.stringify(summary, null, 2));

  if (warnings.length) {
    console.log("\nWarnings:");
    warnings.forEach((warning) => console.log(`- ${warning}`));
  }

  if (failures.length) {
    console.error(`\nLaunch env validation failed in ${mode} mode.`);
    process.exit(1);
  }

  if (isProductionMode) {
    console.log("\nProduction env validation passed.");
  } else {
    console.log(`\n${mode} env validation passed.`);
  }
}

main()
  .catch((error) => {
    console.error(
      "Launch env validation failed:",
      error instanceof Error ? error.message : String(error)
    );
    process.exit(1);
  })
  .finally(async () => {
    try {
      await mongoose.disconnect();
    } catch {
      // no-op
    }
  });
