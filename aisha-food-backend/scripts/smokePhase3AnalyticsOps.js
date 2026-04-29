/* eslint-disable @typescript-eslint/no-require-imports */
const path = require("node:path");

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

loadEnvForScript();

const baseUrl = String(process.env.SMOKE_BASE_URL || "http://localhost:3000").replace(/\/+$/, "");
const adminKey = String(process.env.ADMIN_KEY || "").trim();
const mode = String(process.env.SMOKE_MODE || "enabled").trim().toLowerCase();

if (!adminKey) {
  console.error("Missing ADMIN_KEY env var.");
  process.exit(1);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function getWeekKey(dateInput = new Date()) {
  const date = new Date(
    Date.UTC(dateInput.getUTCFullYear(), dateInput.getUTCMonth(), dateInput.getUTCDate())
  );
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((date.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

async function request(pathname) {
  const res = await fetch(`${baseUrl}${pathname}`);
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { res, text, json };
}

async function resolveCities() {
  const adminCities = await request(`/api/admin/cities?key=${encodeURIComponent(adminKey)}`);
  assert(adminCities.res.ok && adminCities.json?.ok, "Admin cities failed.");
  const rows = Array.isArray(adminCities.json?.cities) ? adminCities.json.cities : [];
  const bamako =
    rows.find((row) => String(row?.code || "").toUpperCase() === "BKO") ||
    rows.find((row) => String(row?.name || "").toLowerCase() === "bamako");
  assert(bamako?._id, "Bamako city missing.");

  const sdq =
    rows.find((row) => String(row?.code || "").toUpperCase() === "SDQ") ||
    rows.find((row) => String(row?.name || "").toLowerCase().includes("santo"));

  return { bamakoId: String(bamako._id), sdqId: sdq ? String(sdq._id) : "" };
}

async function main() {
  console.log(`Running Phase-3 analytics ops smoke against ${baseUrl} (mode=${mode})`);

  const health = await request("/api/health");
  assert(health.res.ok, "Health check failed.");

  await request(`/api/admin/jobs/seed-cities?key=${encodeURIComponent(adminKey)}`);

  const { bamakoId, sdqId } = await resolveCities();
  const weekKey = getWeekKey(new Date());
  const qsBreakdown = `key=${encodeURIComponent(adminKey)}&weekKey=${encodeURIComponent(weekKey)}`;

  const breakdown = await request(`/api/ops/analytics/breakdown?${qsBreakdown}`);
  assert(breakdown.res.ok && breakdown.json?.ok, `Breakdown failed: ${breakdown.text}`);
  const rows = Array.isArray(breakdown.json?.rows) ? breakdown.json.rows : [];
  assert(rows.length >= 1, "Breakdown returned no rows.");
  const bamakoRow =
    rows.find((row) => String(row.cityId || "") === bamakoId) ||
    rows.find((row) => String(row.code || "").toUpperCase() === "BKO");
  assert(bamakoRow, "Breakdown missing Bamako row.");
  if (sdqId) {
    const sdqRow = rows.find((row) => String(row.cityId || "") === sdqId);
    assert(sdqRow, "Breakdown missing SDQ row.");
  }

  const qsCityWeek = `key=${encodeURIComponent(adminKey)}&cityId=${encodeURIComponent(
    bamakoId
  )}&weekKey=${encodeURIComponent(weekKey)}`;
  const cityWeek = await request(`/api/ops/analytics/city-week?${qsCityWeek}`);
  assert(cityWeek.res.ok && cityWeek.json?.ok, `City-week failed: ${cityWeek.text}`);
  const metrics = cityWeek.json?.metrics || {};
  const finance = cityWeek.json?.finance || {};
  const dispatch = cityWeek.json?.dispatch || {};
  assert(typeof metrics.ordersTotal === "number", "City-week metrics missing ordersTotal.");
  assert(typeof finance.commissionTotal === "number", "City-week finance missing commissionTotal.");
  assert(typeof dispatch.assignedCount === "number", "City-week dispatch missing assignedCount.");

  const csvBreakdown = await request(`/api/ops/analytics/breakdown/export.csv?${qsBreakdown}`);
  assert(csvBreakdown.res.ok, `Breakdown CSV failed: ${csvBreakdown.text}`);
  assert(
    csvBreakdown.text.startsWith(
      "cityCode,cityName,weekKey,ordersTotal,delivered,cancelled,commissionTotal,platformDeliveryMarginTotal,riderPayoutTotal,assignedCount,unassignedCount"
    ),
    "Breakdown CSV header mismatch."
  );
  const breakdownLines = csvBreakdown.text.split(/\r?\n/).filter(Boolean);
  assert(breakdownLines.length >= 2, "Breakdown CSV should have header + at least one row.");

  const csvCityWeek = await request(`/api/ops/analytics/city-week/export.csv?${qsCityWeek}`);
  assert(csvCityWeek.res.ok, `City-week CSV failed: ${csvCityWeek.text}`);
  assert(
    csvCityWeek.text.startsWith(
      "cityCode,cityName,weekKey,ordersTotal,delivered,cancelled,grossSubtotalTotal,commissionTotal,deliveryFeeToCustomerTotal,platformDeliveryMarginTotal,riderPayoutTotal,assignedCount,unassignedCount"
    ),
    "City-week CSV header mismatch."
  );
  const cityWeekLines = csvCityWeek.text.split(/\r?\n/).filter(Boolean);
  assert(cityWeekLines.length === 2, "City-week CSV should have exactly header + one row.");

  console.log(
    JSON.stringify(
      {
        weekKey,
        citiesInBreakdown: rows.length,
        bamakoOrders: Number(bamakoRow.ordersTotal || 0),
        bamakoDelivered: Number(bamakoRow.delivered || 0),
        breakdownCsvLines: breakdownLines.length,
        cityWeekCsvLines: cityWeekLines.length,
      },
      null,
      2
    )
  );
  console.log("Smoke phase3-analytics-ops passed.");
}

main().catch((error) => {
  console.error(
    "Smoke phase3-analytics-ops failed:",
    error instanceof Error ? error.message : String(error)
  );
  process.exit(1);
});
