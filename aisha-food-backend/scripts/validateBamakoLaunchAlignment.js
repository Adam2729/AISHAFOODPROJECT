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

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function readRepoFile(relativePath) {
  return fs.readFileSync(path.resolve(process.cwd(), relativePath), "utf8");
}

function assertIncludes(source, snippet, message) {
  assert(source.includes(snippet), message);
}

function normalize(value) {
  return String(value || "").trim();
}

function normalizeDigits(value) {
  return normalize(value).replace(/\D+/g, "");
}

function inferRuntimeStage() {
  const explicitStage = normalize(
    process.env.APP_ENV || process.env.VERCEL_ENV || process.env.DEPLOY_ENV
  ).toLowerCase();
  if (explicitStage === "production") return "production";
  if (explicitStage === "preview" || explicitStage === "staging") return "preview";

  const publicApiBaseUrl = normalize(process.env.PUBLIC_API_BASE_URL).toLowerCase();
  if (publicApiBaseUrl && /(preview|staging|qa|sandbox|test|dev)/.test(publicApiBaseUrl)) {
    return "preview";
  }

  return normalize(process.env.NODE_ENV).toLowerCase() === "production"
    ? "production"
    : "development";
}

async function main() {
  loadEnvForScript();

  const mongoUri = String(process.env.MONGODB_URI || "").trim();
  const launchCityCode = String(process.env.LAUNCH_CITY_CODE || "BKO").trim().toUpperCase() || "BKO";
  const bamakoEnabled = String(process.env.MULTICITY_ENABLE_BAMAKO ?? "true").trim().toLowerCase() !== "false";
  const supportWhatsApp = normalizeDigits(process.env.SUPPORT_WHATSAPP_E164);
  const runtimeStage = inferRuntimeStage();
  const devLocationBypass =
    normalize(process.env.DEV_ALLOW_ORDER_LOCATION_BYPASS || "false").toLowerCase() === "true";
  const warnings = [];
  const failures = [];
  const supportConfigured =
    supportWhatsApp.length >= 7 &&
    supportWhatsApp !== "18090000000" &&
    supportWhatsApp !== "22300000000";

  assert(mongoUri, "MONGODB_URI is required for launch validation.");
  assert(
    launchCityCode === "BKO" || launchCityCode === "SDQ",
    `Unexpected LAUNCH_CITY_CODE: ${launchCityCode}`
  );

  const merchantOnboarding = readRepoFile("src/lib/merchantOnboarding.ts");
  const deliveryPolicy = readRepoFile("src/lib/deliveryPolicy.ts");
  const businessModel = readRepoFile("src/models/Business.ts");
  const orderModel = readRepoFile("src/models/Order.ts");
  const merchantSettingsRoute = readRepoFile("src/app/api/merchant/business/settings/route.ts");
  const merchantApproveRoute = readRepoFile(
    "src/app/api/admin/merchant-applications/[id]/approve/route.ts"
  );
  const cityLib = readRepoFile("src/lib/city.ts");
  const googleMapsLib = readRepoFile("src/lib/googleMaps.ts");
  const envLib = readRepoFile("src/lib/env.ts");
  const marketFormatting = readRepoFile("src/lib/marketFormatting.ts");
  const rootPage = readRepoFile("src/app/page.tsx");
  const merchantDashboard = readRepoFile("src/app/merchant/dashboard/page.tsx");
  const merchantOrders = readRepoFile("src/app/merchant/orders/page.tsx");
  const merchantFinance = readRepoFile("src/app/merchant/finance/page.tsx");
  const merchantStatements = readRepoFile("src/app/merchant/finance/statements/page.tsx");
  const adminDashboard = readRepoFile("src/app/admin/page.tsx");
  const adminSettlements = readRepoFile("src/app/admin/settlements/page.tsx");
  const adminPromos = readRepoFile("src/app/admin/promos/page.tsx");
  const adminOps = readRepoFile("src/app/admin/ops/page.tsx");
  const financeMismatchesPanel = readRepoFile("src/app/admin/ops/FinanceMismatchesPanel.tsx");
  const cashReconciliationPanel = readRepoFile("src/app/admin/ops/CashReconciliationPanel.tsx");
  const dispatchPanel = readRepoFile("src/app/admin/ops/DispatchPanel.tsx");

  assertIncludes(
    merchantOnboarding,
    'DO: "own_driver"',
    "DR launch default delivery type should be explicit and configurable."
  );
  assertIncludes(
    merchantOnboarding,
    'ML: "own_driver"',
    "Mali launch default delivery type should be explicit and self-delivery-safe."
  );

  assertIncludes(
    deliveryPolicy,
    '"platform_driver"',
    "deliveryPolicy.ts must preserve platform_driver support."
  );
  assertIncludes(
    deliveryPolicy,
    '"self_delivery"',
    "deliveryPolicy.ts must preserve self_delivery support."
  );
  assertIncludes(
    deliveryPolicy,
    "export function resolveOperationalOrderDeliveryMode",
    "deliveryPolicy.ts must resolve order delivery mode operationally."
  );

  assertIncludes(
    businessModel,
    'enum: ["self_delivery", "platform_driver"]',
    "Business.deliveryPolicy.mode must support both delivery modes."
  );
  assertIncludes(
    orderModel,
    'enum: ["self_delivery", "platform_driver"]',
    "Order.deliverySnapshot.mode must support both delivery modes."
  );

  assertIncludes(
    merchantSettingsRoute,
    '"deliveryPolicy.mode"',
    "Merchant settings route must sync delivery policy mode."
  );
  assertIncludes(
    merchantApproveRoute,
    "getDefaultDeliveryPolicy",
    "Merchant approval route must create delivery-policy-compatible businesses."
  );

  assertIncludes(cityLib, 'const BAMAKO_CITY_CODE = "BKO"', "city.ts must keep Bamako city support.");
  assertIncludes(
    cityLib,
    "ENV_MULTICITY_ENABLE_BAMAKO",
    "city.ts must remain aware of Bamako city gating."
  );
  assertIncludes(
    cityLib,
    "listCitiesForPublic",
    "city.ts must expose public city listing for launch validation."
  );
  assertIncludes(
    googleMapsLib,
    "inferAddressHint",
    "googleMaps.ts should use market-aware address hints."
  );
  assertIncludes(
    envLib,
    'LAUNCH_CITY_CODE: z.string().default("BKO")',
    "env.ts must default launch city to Bamako-safe BKO."
  );
  assertIncludes(
    envLib,
    'MULTICITY_ENABLE_BAMAKO: boolFromEnv.default(true)',
    "env.ts must keep Bamako enabled by default for the launch path."
  );
  assertIncludes(
    marketFormatting,
    "formatMoneyForProfile",
    "marketFormatting.ts must provide shared money formatting."
  );
  assertIncludes(
    marketFormatting,
    "formatDateTimeForProfile",
    "marketFormatting.ts must provide shared date formatting."
  );

  assertIncludes(rootPage, 'href="/restaurants"', "Root page should route launch traffic to the public catalog.");
  assertIncludes(
    rootPage,
    "Aisha Food for",
    "Root page should be a public launch surface, not an internal backend stub."
  );

  assertIncludes(
    merchantDashboard,
    "useMerchantLaunchProfile",
    "Merchant dashboard must use market-aware launch profile data."
  );
  assertIncludes(
    merchantOrders,
    "usingPlatformDriver",
    "Merchant orders page must branch for both delivery models."
  );
  assertIncludes(
    merchantFinance,
    "formatMoneyForProfile",
    "Merchant finance page must use market-aware money formatting."
  );
  assertIncludes(
    merchantStatements,
    "formatDateTimeForProfile",
    "Merchant statements page must use market-aware date formatting."
  );

  assertIncludes(
    adminDashboard,
    "useAdminLaunchMarket",
    "Admin dashboard must use launch-market formatting."
  );
  assertIncludes(
    adminSettlements,
    "formatMoneyForProfile",
    "Admin settlements page must use market-aware money formatting."
  );
  assertIncludes(
    adminPromos,
    "formatMoneyForProfile",
    "Admin promos page must use market-aware money formatting."
  );
  assertIncludes(
    adminOps,
    "OPS_MARKET_PROFILE",
    "Admin ops page must use launch-market formatting defaults."
  );
  assertIncludes(
    financeMismatchesPanel,
    "useAdminLaunchMarket",
    "Finance mismatches panel must use launch-market formatting."
  );
  assertIncludes(
    cashReconciliationPanel,
    "useAdminLaunchMarket",
    "Cash reconciliation panel must use launch-market formatting."
  );
  assertIncludes(
    dispatchPanel,
    "useAdminLaunchMarket",
    "Dispatch panel must use launch-market formatting."
  );

  await mongoose.connect(mongoUri);
  const db = mongoose.connection.db;
  assert(db, "Mongo connection failed.");

  const cities = await db
    .collection("cities")
    .find({}, { projection: { code: 1, name: 1, country: 1, currency: 1, isActive: 1 } })
    .toArray();
  const launchCity = cities.find((city) => String(city.code || "").toUpperCase() === launchCityCode);
  const bamakoCity = cities.find((city) => String(city.code || "").toUpperCase() === "BKO");

  assert(launchCity, `Launch city ${launchCityCode} is missing from cities collection.`);
  assert(Boolean(launchCity.isActive), `Launch city ${launchCityCode} must be active.`);
  if (launchCityCode === "BKO" || bamakoEnabled) {
    assert(bamakoCity, "Bamako city record is missing.");
    assert(Boolean(bamakoCity.isActive), "Bamako city must be active for the launch-aligned path.");
  }

  if (runtimeStage === "production" && !supportConfigured) {
    failures.push("SUPPORT_WHATSAPP_E164");
  } else if (!supportConfigured) {
    warnings.push(
      runtimeStage === "preview"
        ? "Support WhatsApp is missing. Preview can continue, but production is not launch-ready."
        : "Support WhatsApp is missing. Local UK testing can continue, but production is not launch-ready."
    );
  }

  if (devLocationBypass) {
    warnings.push(
      runtimeStage === "production"
        ? "DEV_ALLOW_ORDER_LOCATION_BYPASS is enabled. Orders can continue, but this is unsafe for production."
        : runtimeStage === "preview"
        ? "DEV_ALLOW_ORDER_LOCATION_BYPASS is enabled. Preview testing can continue, but this is unsafe for production."
        : "DEV_ALLOW_ORDER_LOCATION_BYPASS is enabled. Allowed for local UK testing only."
    );
  }

  console.log(
    JSON.stringify(
      {
        ok: failures.length === 0,
        runtimeStage,
        launchCityCode,
        bamakoEnabled,
        supportWhatsAppConfigured: supportConfigured,
        devLocationBypass,
        warnings,
        failures,
        launchCity: {
          code: launchCity.code,
          name: launchCity.name,
          country: launchCity.country,
          currency: launchCity.currency,
          isActive: Boolean(launchCity.isActive),
        },
        cityCodes: cities.map((city) => ({
          code: city.code,
          active: Boolean(city.isActive),
        })),
      },
      null,
      2
    )
  );

  if (failures.length) {
    process.exit(1);
  }
}

main()
  .catch((error) => {
    console.error(
      "Bamako launch alignment validation failed:",
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
