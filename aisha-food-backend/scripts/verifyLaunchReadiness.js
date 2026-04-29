/* eslint-disable @typescript-eslint/no-require-imports */
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

function normalizeUpper(value) {
  return normalize(value).toUpperCase();
}

function parseArg(name) {
  const prefix = `--${name}=`;
  const match = process.argv.find((entry) => entry.startsWith(prefix));
  return match ? match.slice(prefix.length).trim() : "";
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      ...(options.headers || {}),
    },
    ...options,
  });
  const json = await response.json().catch(() => null);
  return { response, json };
}

function printCheck(label, ok, detail) {
  const prefix = ok ? "[PASS]" : "[FAIL]";
  console.log(`${prefix} ${label}${detail ? `: ${detail}` : ""}`);
}

async function main() {
  loadEnvForScript();

  const mongoUri = normalize(process.env.MONGODB_URI);
  const adminKey = normalize(process.env.ADMIN_KEY);
  const launchCityCode = normalizeUpper(parseArg("cityCode") || process.env.LAUNCH_CITY_CODE || "BKO") || "BKO";
  const baseUrl = normalize(parseArg("baseUrl") || process.env.PUBLIC_API_BASE_URL || "http://localhost:3000").replace(/\/+$/, "");
  const failures = [];

  if (!mongoUri) {
    throw new Error("MONGODB_URI is required for launch verification.");
  }

  await mongoose.connect(mongoUri);
  const db = mongoose.connection.db;
  const launchCity = await db
    .collection("cities")
    .findOne(
      { code: launchCityCode },
      {
        projection: {
          _id: 1,
          code: 1,
          name: 1,
          country: 1,
          coverageCenterLat: 1,
          coverageCenterLng: 1,
          isActive: 1,
        },
      }
    );
  if (!launchCity || !launchCity.isActive) {
    throw new Error(`Launch city ${launchCityCode} is missing or inactive.`);
  }

  const cityId = String(launchCity._id);
  const cityHeaders = { "x-city": cityId, "x-city-id": cityId };

  const statusCheck = await fetchJson(`${baseUrl}/api/status`);
  const statusOk = Boolean(statusCheck.response.ok && statusCheck.json?.ok);
  printCheck("Status endpoint", statusOk, `${statusCheck.response.status}`);
  if (!statusOk) failures.push("/api/status");

  const citiesCheck = await fetchJson(`${baseUrl}/api/public/cities`);
  const cities = Array.isArray(citiesCheck.json?.cities) ? citiesCheck.json.cities : [];
  const matchedCity =
    cities.find((row) => String(row?._id || "") === cityId) ||
    cities.find((row) => normalizeUpper(row?.code) === launchCityCode) ||
    null;
  const citiesOk = Boolean(citiesCheck.response.ok && matchedCity);
  printCheck("Public cities endpoint", citiesOk, matchedCity ? `${matchedCity.name} (${matchedCity.code})` : `${citiesCheck.response.status}`);
  if (!citiesOk) failures.push("/api/public/cities");

  const restaurantsCheck = await fetchJson(`${baseUrl}/api/public/restaurants?limit=1`, {
    headers: cityHeaders,
  });
  const restaurants = Array.isArray(restaurantsCheck.json?.rows) ? restaurantsCheck.json.rows : [];
  const firstRestaurant = restaurants[0] || null;
  const restaurantsOk = Boolean(restaurantsCheck.response.ok && firstRestaurant);
  printCheck(
    "Public restaurants endpoint",
    restaurantsOk,
    firstRestaurant ? `${firstRestaurant.name} (${firstRestaurant.restaurantId})` : `${restaurantsCheck.response.status}`
  );
  if (!restaurantsOk) failures.push("/api/public/restaurants");

  if (firstRestaurant?.slug) {
    const menuCheck = await fetchJson(
      `${baseUrl}/api/public/restaurants/${encodeURIComponent(firstRestaurant.slug)}/menu`,
      { headers: cityHeaders }
    );
    const menuItems = Array.isArray(menuCheck.json?.menu) ? menuCheck.json.menu : [];
    const menuOk = Boolean(menuCheck.response.ok && menuItems.length > 0);
    printCheck("Restaurant menu endpoint", menuOk, `${menuItems.length} item(s)`);
    if (!menuOk) failures.push("/api/public/restaurants/[slug]/menu");
  }

  if (firstRestaurant) {
    const quoteCheck = await fetchJson(
      `${baseUrl}/api/public/delivery/quote?businessId=${encodeURIComponent(firstRestaurant.restaurantId)}&lat=${encodeURIComponent(String(launchCity.coverageCenterLat || ""))}&lng=${encodeURIComponent(String(launchCity.coverageCenterLng || ""))}`,
      { headers: cityHeaders }
    );
    const quoteOk = Boolean(quoteCheck.response.ok && quoteCheck.json?.ok);
    printCheck("Delivery quote precheck", quoteOk, `${quoteCheck.response.status}`);
    if (!quoteOk) failures.push("/api/public/delivery/quote");
  }

  const uniqueSuffix = Date.now();
  const merchantPayload = {
    merchantType: "restaurant",
    deliveryType: "own_driver",
    businessName: `Launch Smoke Merchant ${uniqueSuffix}`,
    ownerName: "Launch Smoke",
    phone: `+2237000${String(uniqueSuffix).slice(-6)}`,
    email: `launch-smoke-${uniqueSuffix}@example.com`,
    cityName: String(launchCity.name || ""),
    country: String(launchCity.country || ""),
    address: "Launch smoke application",
    notes: "Launch smoke verification submission",
  };
  const merchantCheck = await fetchJson(`${baseUrl}/api/public/merchant-applications`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...cityHeaders },
    body: JSON.stringify(merchantPayload),
  });
  const merchantOk = Boolean(merchantCheck.response.ok && merchantCheck.json?.applicationId);
  printCheck("Merchant application submission", merchantOk, `${merchantCheck.response.status}`);
  if (!merchantOk) failures.push("/api/public/merchant-applications");

  const driverPayload = {
    name: "Launch Smoke Driver",
    phone: `+2237100${String(uniqueSuffix).slice(-6)}`,
    zoneLabel: String(launchCity.name || ""),
    notes: "Launch smoke verification submission",
  };
  const driverCheck = await fetchJson(`${baseUrl}/api/public/driver-applications`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...cityHeaders },
    body: JSON.stringify(driverPayload),
  });
  const driverOk = Boolean(driverCheck.response.ok && driverCheck.json?.applicationId);
  printCheck("Driver application submission", driverOk, `${driverCheck.response.status}`);
  if (!driverOk) failures.push("/api/public/driver-applications");

  const launchContextCheck = await fetchJson(`${baseUrl}/api/admin/launch-context`, {
    headers: adminKey ? { "x-admin-key": adminKey } : {},
  });
  const launchContextOk = Boolean(
    launchContextCheck.response.ok &&
      launchContextCheck.json?.ok &&
      Array.isArray(launchContextCheck.json?.readiness?.deliveryModesSupported) &&
      launchContextCheck.json.readiness.deliveryModesSupported.includes("self_delivery") &&
      launchContextCheck.json.readiness.deliveryModesSupported.includes("platform_driver")
  );
  printCheck(
    "Admin launch context endpoint",
    launchContextOk,
    launchContextCheck.json?.readiness?.publicApiBaseUrl || `${launchContextCheck.response.status}`
  );
  if (!launchContextOk) failures.push("/api/admin/launch-context");

  const supportOk = Boolean(launchContextCheck.json?.readiness?.supportWhatsAppConfigured);
  printCheck(
    "Support configuration sanity",
    supportOk,
    supportOk ? launchContextCheck.json?.readiness?.supportWhatsApp : "not configured"
  );
  if (!supportOk) failures.push("supportWhatsAppConfigured");

  console.log(
    "\nLaunch verification summary:\n" +
      JSON.stringify(
        {
          baseUrl,
          launchCityCode,
          cityId,
          deliveryModesSupported: launchContextCheck.json?.readiness?.deliveryModesSupported || [],
          supportWhatsAppConfigured: Boolean(launchContextCheck.json?.readiness?.supportWhatsAppConfigured),
          publicApiBaseUrl: launchContextCheck.json?.readiness?.publicApiBaseUrl || null,
        },
        null,
        2
      )
  );

  if (failures.length) {
    console.error("\nLaunch verification failed:");
    failures.forEach((failure) => console.error(`- ${failure}`));
    process.exit(1);
  }

  console.log("\nLaunch verification passed.");
}

main()
  .catch((error) => {
    console.error(
      "Launch verification failed:",
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
