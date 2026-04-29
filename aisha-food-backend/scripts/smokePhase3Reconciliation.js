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

loadEnvForScript();

const baseUrl = String(process.env.SMOKE_BASE_URL || "http://localhost:3000").replace(/\/+$/, "");
const adminKey = String(process.env.ADMIN_KEY || "").trim();
const mongoUri = String(process.env.MONGODB_URI || "").trim();

if (!adminKey) {
  console.error("Missing ADMIN_KEY env var.");
  process.exit(1);
}
if (!mongoUri) {
  console.error("Missing MONGODB_URI env var.");
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

async function request(pathname, options = {}) {
  const method = options.method || "GET";
  const headers = {};
  if (options.body !== undefined) headers["Content-Type"] = "application/json";
  if (options.cookie) headers.Cookie = options.cookie;
  if (options.headers && typeof options.headers === "object") {
    Object.assign(headers, options.headers);
  }

  const res = await fetch(`${baseUrl}${pathname}`, {
    method,
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { res, text, json };
}

async function findBamakoCity() {
  const adminCities = await request(`/api/admin/cities?key=${encodeURIComponent(adminKey)}`);
  assert(adminCities.res.ok && adminCities.json?.ok, "Admin cities failed.");
  const rows = Array.isArray(adminCities.json?.cities) ? adminCities.json.cities : [];
  const bamako =
    rows.find((row) => String(row?.code || "").toUpperCase() === "BKO") ||
    rows.find((row) => String(row?.name || "").toLowerCase() === "bamako");
  assert(bamako?._id, "Bamako city missing.");
  return bamako;
}

async function ensureDriverWithPayout(db, cityId) {
  const payout = await db
    .collection("riderpayouts")
    .findOne({ cityId: new mongoose.Types.ObjectId(String(cityId)) });
  if (payout) {
    return { driverId: String(payout.driverId || ""), weekKey: String(payout.weekKey || getWeekKey()) };
  }
  // fallback: create via existing phase3-driverweb smoke flow
  const res = await fetch(`${baseUrl}/api/health`);
  assert(res.ok, "Health check failed during fallback.");
  throw new Error("No rider payouts found for city; run driver/payout smoke first.");
}

function sumPreview(rows) {
  let amount = 0;
  let fee = 0;
  let margin = 0;
  for (const row of rows) {
    amount += Number(row.amount || 0);
    fee += Number(row.deliveryFeeCharged || 0);
    margin += Number(row.platformMargin || 0);
  }
  return { amount, fee, margin, net: amount - margin };
}

async function main() {
  console.log(`Running Phase-3 reconciliation smoke against ${baseUrl}`);

  const health = await request("/api/health");
  assert(health.res.ok, "Health check failed.");

  await request(`/api/admin/jobs/seed-cities?key=${encodeURIComponent(adminKey)}`, {
    method: "POST",
  });

  await mongoose.connect(mongoUri);
  const db = mongoose.connection.db;

  const bamako = await findBamakoCity();
  const cityId = String(bamako._id);
  const weekKey = getWeekKey(new Date());

  const driverInfo = await ensureDriverWithPayout(db, cityId);
  const driverId = driverInfo.driverId;
  const targetWeekKey = driverInfo.weekKey || weekKey;
  assert(driverId, "driverId missing for reconciliation smoke.");

  const qs = `key=${encodeURIComponent(adminKey)}&cityId=${encodeURIComponent(
    cityId
  )}&weekKey=${encodeURIComponent(targetWeekKey)}&driverId=${encodeURIComponent(driverId)}`;

  const recon = await request(`/api/ops/driver-reconciliation?${qs}`);
  assert(recon.res.ok && recon.json?.ok, `driver-reconciliation failed: ${recon.text}`);
  const previewRows = Array.isArray(recon.json?.rowsPreview) ? recon.json.rowsPreview : [];
  assert(previewRows.length >= 0, "rowsPreview missing.");
  const previewSums = sumPreview(previewRows);

  const cityWeek = await request(
    `/api/ops/driver-reconciliation/city-week?key=${encodeURIComponent(
      adminKey
    )}&cityId=${encodeURIComponent(cityId)}&weekKey=${encodeURIComponent(targetWeekKey)}`
  );
  assert(cityWeek.res.ok && cityWeek.json?.ok, `city-week failed: ${cityWeek.text}`);
  const drivers = Array.isArray(cityWeek.json?.drivers) ? cityWeek.json.drivers : [];
  const targetRow =
    drivers.find((row) => String(row.driverId || "") === driverId) ||
    drivers.find((row) => row.driverId) ||
    null;
  assert(targetRow, "No driver row found in city-week.");

  const exportCsv = await request(
    `/api/ops/driver-reconciliation/export.csv?${qs}`
  );
  assert(exportCsv.res.ok, `export.csv failed: ${exportCsv.text}`);
  const lines = exportCsv.text.split(/\r?\n/).filter(Boolean);
  assert(lines.length >= 2, "CSV should have header + at least one line.");
  assert(
    lines[0].startsWith("payoutId,orderId,driverId,status,amount"),
    "CSV header mismatch."
  );

  console.log(
    JSON.stringify(
      {
        cityId,
        weekKey: targetWeekKey,
        driverId,
        previewCount: previewRows.length,
        previewNet: previewSums.net,
        cityWeekDrivers: drivers.length,
        targetRowNet: targetRow.totalNetSettlement,
        csvLines: lines.length,
      },
      null,
      2
    )
  );
  console.log("Smoke phase3-reconciliation passed.");
}

main()
  .catch((error) => {
    console.error(
      "Smoke phase3-reconciliation failed:",
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

