/* eslint-disable @typescript-eslint/no-require-imports */
const path = require("node:path");
const { execFileSync } = require("node:child_process");

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

if (!adminKey) {
  console.error("Missing ADMIN_KEY env var.");
  process.exit(1);
}

function getWeekKey(dateInput = new Date()) {
  const date = new Date(Date.UTC(dateInput.getUTCFullYear(), dateInput.getUTCMonth(), dateInput.getUTCDate()));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((date.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

async function request(pathname, options) {
  const method = options?.method || "GET";
  const headers = {
    "Content-Type": "application/json",
    ...(options?.headers || {}),
  };
  const response = await fetch(`${baseUrl}${pathname}`, {
    method,
    headers,
    body: options?.body ? JSON.stringify(options.body) : undefined,
  });
  return response;
}

async function requestJson(pathname, options) {
  const response = await request(pathname, options);
  const text = await response.text();
  const json = text ? JSON.parse(text) : {};
  return { response, json, text };
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function ensureSomeData(weekKey) {
  const mismatch = await requestJson(
    `/api/admin/finance/mismatches?key=${encodeURIComponent(adminKey)}&weekKey=${encodeURIComponent(
      weekKey
    )}&limit=5`
  );
  assert(mismatch.response.ok, "Mismatches endpoint failed before seed.");
  const beforeRows = Array.isArray(mismatch.json?.rows) ? mismatch.json.rows : [];
  if (beforeRows.length > 0) return { seeded: false, rowCount: beforeRows.length };

  console.log("No finance rows found. Running base smokeSuite to seed a delivered counted order...");
  execFileSync("node", ["scripts/smokeSuite.js"], {
    stdio: "inherit",
    cwd: process.cwd(),
    env: { ...process.env, SMOKE_BASE_URL: baseUrl, ADMIN_KEY: adminKey },
  });

  const recompute = await requestJson(
    `/api/admin/jobs/cash-collections-compute?key=${encodeURIComponent(adminKey)}&weekKey=${encodeURIComponent(
      weekKey
    )}`,
    { method: "POST" }
  );
  assert(recompute.response.ok, "Cash collections recompute after seeding failed.");

  const after = await requestJson(
    `/api/admin/finance/mismatches?key=${encodeURIComponent(adminKey)}&weekKey=${encodeURIComponent(
      weekKey
    )}&limit=5`
  );
  assert(after.response.ok, "Mismatches endpoint failed after seed.");
  const afterRows = Array.isArray(after.json?.rows) ? after.json.rows : [];
  return { seeded: true, rowCount: afterRows.length };
}

async function main() {
  console.log(`Running finance alignment smoke against ${baseUrl}`);

  const health = await requestJson("/api/health");
  assert(health.response.ok, "Health check failed.");

  const weekKey = getWeekKey(new Date());

  const compute = await requestJson(
    `/api/admin/jobs/cash-collections-compute?key=${encodeURIComponent(adminKey)}&weekKey=${encodeURIComponent(
      weekKey
    )}`,
    { method: "POST" }
  );
  assert(compute.response.ok, "Cash collections compute job failed.");
  assert(Boolean(compute.json?.ok), "Cash compute response not ok.");

  const seedInfo = await ensureSomeData(weekKey);

  const mismatches = await requestJson(
    `/api/admin/finance/mismatches?key=${encodeURIComponent(adminKey)}&weekKey=${encodeURIComponent(
      weekKey
    )}&limit=200`
  );
  assert(mismatches.response.ok, "Finance mismatches endpoint failed.");
  assert(Boolean(mismatches.json?.ok), "Finance mismatches response not ok.");
  assert(Array.isArray(mismatches.json?.rows), "Finance mismatches rows missing.");
  assert(Boolean(mismatches.json?.summary), "Finance mismatches summary missing.");

  const exportRes = await request(
    `/api/admin/finance/export?key=${encodeURIComponent(adminKey)}&weekKey=${encodeURIComponent(weekKey)}`
  );
  const exportText = await exportRes.text();
  assert(exportRes.ok, "Finance export endpoint failed.");
  const contentType = String(exportRes.headers.get("content-type") || "");
  assert(contentType.toLowerCase().includes("text/csv"), "Finance export content-type is not text/csv.");
  assert(exportText.includes("weekKey,businessId,businessName"), "Finance export header missing.");

  const anomalies = await requestJson(
    `/api/admin/jobs/finance-anomalies?key=${encodeURIComponent(adminKey)}&weekKey=${encodeURIComponent(
      weekKey
    )}`,
    { method: "POST" }
  );
  assert(anomalies.response.ok, "Finance anomalies job failed.");
  assert(Boolean(anomalies.json?.ok), "Finance anomalies response not ok.");
  assert(Object.prototype.hasOwnProperty.call(anomalies.json, "eventsInserted"), "eventsInserted missing.");
  assert(Object.prototype.hasOwnProperty.call(anomalies.json, "eventsSkipped"), "eventsSkipped missing.");

  const totalRows = Array.isArray(mismatches.json?.rows) ? mismatches.json.rows.length : 0;
  if (totalRows === 0) {
    console.log(
      "Finance alignment smoke passed (endpoints healthy, no rows available for current week)."
    );
  } else {
    console.log("Finance alignment smoke passed.");
  }

  console.log(
    JSON.stringify(
      {
        weekKey,
        seededData: seedInfo.seeded,
        mismatchRows: totalRows,
        eventsInserted: Number(anomalies.json?.eventsInserted || 0),
        eventsSkipped: Number(anomalies.json?.eventsSkipped || 0),
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error("Finance alignment smoke failed:", error instanceof Error ? error.message : String(error));
  process.exit(1);
});
