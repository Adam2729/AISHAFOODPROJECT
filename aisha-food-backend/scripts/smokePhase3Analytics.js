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

async function main() {
  console.log(`Running Phase-3 analytics smoke against ${baseUrl} (mode=${mode})`);

  const health = await request("/api/health");
  assert(health.res.ok, "Health check failed.");

  await request(`/api/admin/jobs/seed-cities?key=${encodeURIComponent(adminKey)}`);

  const [adminCitiesRes, publicCitiesRes] = await Promise.all([
    request(`/api/admin/cities?key=${encodeURIComponent(adminKey)}`),
    request("/api/public/cities"),
  ]);
  assert(adminCitiesRes.res.ok && adminCitiesRes.json?.ok, "Could not load admin cities.");
  assert(publicCitiesRes.res.ok && publicCitiesRes.json?.ok, "Could not load public cities.");

  const adminCities = Array.isArray(adminCitiesRes.json?.cities) ? adminCitiesRes.json.cities : [];
  const publicCities = Array.isArray(publicCitiesRes.json?.cities) ? publicCitiesRes.json.cities : [];

  const bamakoAdmin =
    adminCities.find((row) => String(row?.code || "").toUpperCase() === "BKO") || null;
  assert(bamakoAdmin?._id, "Bamako city missing in admin cities.");

  const publicCodes = new Set(publicCities.map((row) => String(row?.code || "").toUpperCase()));
  if (mode === "enabled") {
    assert(
      publicCodes.has("BKO"),
      "Mode=enabled requires Bamako to be publicly active."
    );
  }

  const selectedCityId =
    mode === "enabled"
      ? String(bamakoAdmin._id)
      : String(
          (adminCities.find((row) => String(row?.code || "").toUpperCase() === "SDQ")?._id) ||
            adminCities[0]?._id ||
            ""
        );
  assert(selectedCityId, "Could not resolve selected cityId.");

  const anotherCityId = String(
    adminCities.find((row) => String(row?._id || "") !== selectedCityId)?._id || ""
  );
  const weekKey = getWeekKey(new Date());
  const qs = `key=${encodeURIComponent(adminKey)}&cityId=${encodeURIComponent(
    selectedCityId
  )}&weekKey=${encodeURIComponent(weekKey)}`;

  const [metricsRes, financeRes, dispatchRes, breakdownRes] = await Promise.all([
    request(`/api/ops/analytics/metrics?${qs}`),
    request(`/api/ops/analytics/finance?${qs}`),
    request(`/api/ops/analytics/dispatch?${qs}`),
    request(`/api/ops/analytics/city-breakdown?key=${encodeURIComponent(adminKey)}&weekKey=${encodeURIComponent(weekKey)}`),
  ]);

  assert(metricsRes.res.ok && metricsRes.json?.ok, `Metrics failed: ${metricsRes.text}`);
  assert(financeRes.res.ok && financeRes.json?.ok, `Finance failed: ${financeRes.text}`);
  assert(dispatchRes.res.ok && dispatchRes.json?.ok, `Dispatch failed: ${dispatchRes.text}`);
  assert(breakdownRes.res.ok && breakdownRes.json?.ok, `City breakdown failed: ${breakdownRes.text}`);

  assert(String(metricsRes.json?.cityId || "") === selectedCityId, "Metrics cityId mismatch.");
  assert(String(financeRes.json?.cityId || "") === selectedCityId, "Finance cityId mismatch.");
  assert(String(dispatchRes.json?.cityId || "") === selectedCityId, "Dispatch cityId mismatch.");

  const metrics = metricsRes.json?.metrics || {};
  assert(typeof metrics.ordersTotal === "number", "Metrics shape missing ordersTotal.");
  if (Number(metrics.ordersTotal || 0) > 0) {
    assert(Number(metrics.ordersTotal || 0) >= 1, "ordersTotal should be >= 1 when present.");
  }

  const finance = financeRes.json?.finance || {};
  assert(
    typeof finance.commissionTotal === "number",
    "Finance shape missing commissionTotal."
  );

  const dispatch = dispatchRes.json?.dispatch || {};
  assert(typeof dispatch.assignedCount === "number", "Dispatch shape missing assignedCount.");

  const breakdownRows = Array.isArray(breakdownRes.json?.rows) ? breakdownRes.json.rows : [];
  assert(breakdownRows.every((row) => typeof row.cityId === "string"), "Invalid breakdown rows.");

  if (anotherCityId) {
    const scopedArrays = [
      metricsRes.json?.rows,
      metricsRes.json?.drivers,
      financeRes.json?.rows,
      dispatchRes.json?.rows,
    ].filter(Array.isArray);
    for (const arr of scopedArrays) {
      for (const row of arr) {
        if (row && typeof row === "object" && "cityId" in row) {
          assert(
            String(row.cityId || "") === selectedCityId,
            "City-scoped endpoint leaked another city row."
          );
        }
      }
    }
  }

  const page1 = await request(
    `/ops/analytics?key=${encodeURIComponent(adminKey)}&cityId=${encodeURIComponent(
      selectedCityId
    )}&weekKey=${encodeURIComponent(weekKey)}`
  );
  const page2 = await request(
    `/ops/analytics/city-breakdown?key=${encodeURIComponent(adminKey)}&weekKey=${encodeURIComponent(
      weekKey
    )}`
  );
  assert(page1.res.ok, "Ops analytics page failed.");
  assert(page2.res.ok, "Ops analytics city-breakdown page failed.");

  console.log(
    JSON.stringify(
      {
        mode,
        cityId: selectedCityId,
        weekKey,
        metrics: {
          ordersTotal: Number(metrics.ordersTotal || 0),
          delivered: Number(metrics.ordersDelivered || 0),
          cancelled: Number(metrics.ordersCancelled || 0),
        },
        finance: {
          commissionTotal: Number(finance.commissionTotal || 0),
          platformDeliveryMarginTotal: Number(finance.platformDeliveryMarginTotal || 0),
        },
        dispatch: {
          assignedCount: Number(dispatch.assignedCount || 0),
          unassignedCount: Number(dispatch.unassignedCount || 0),
        },
        cityBreakdownRows: breakdownRows.length,
      },
      null,
      2
    )
  );
  console.log("Smoke phase3-analytics passed.");
}

main().catch((error) => {
  console.error(
    "Smoke phase3-analytics failed:",
    error instanceof Error ? error.message : String(error)
  );
  process.exit(1);
});
