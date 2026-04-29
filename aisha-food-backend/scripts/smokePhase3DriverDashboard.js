/* eslint-disable @typescript-eslint/no-require-imports */
const path = require("node:path");
const crypto = require("node:crypto");
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
const linkSecret = String(process.env.DRIVER_LINK_SECRET || process.env.JWT_SECRET || "").trim();

if (!adminKey) {
  console.error("Missing ADMIN_KEY env var.");
  process.exit(1);
}
if (!mongoUri) {
  console.error("Missing MONGODB_URI env var.");
  process.exit(1);
}
if (!linkSecret) {
  console.error("Missing DRIVER_LINK_SECRET or JWT_SECRET env var.");
  process.exit(1);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
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

function createDriverLinkToken(driverId, cityId, days = 7) {
  const payload = {
    driverId: String(driverId || ""),
    cityId: String(cityId || ""),
    exp: Math.floor(Date.now() / 1000) + Math.max(1, days) * 24 * 60 * 60,
  };
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = crypto.createHmac("sha256", linkSecret).update(encodedPayload).digest("base64url");
  return `${encodedPayload}.${signature}`;
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

async function main() {
  console.log(`Running Phase-3 driver dashboard smoke against ${baseUrl}`);

  const health = await request("/api/health");
  assert(health.res.ok, "Health check failed.");

  await request(`/api/admin/jobs/seed-cities?key=${encodeURIComponent(adminKey)}`, {
    method: "POST",
  });

  const adminCities = await request(`/api/admin/cities?key=${encodeURIComponent(adminKey)}`);
  assert(adminCities.res.ok && adminCities.json?.ok, "Admin cities failed.");
  const adminRows = Array.isArray(adminCities.json?.cities) ? adminCities.json.cities : [];
  const bamako =
    adminRows.find((row) => String(row?.code || "").toUpperCase() === "BKO") ||
    adminRows.find((row) => String(row?.name || "").toLowerCase() === "bamako");
  assert(bamako?._id, "Bamako city missing.");
  const cityId = String(bamako._id);

  await mongoose.connect(mongoUri);

  const payout = await mongoose.connection.db
    .collection("riderpayouts")
    .findOne({ cityId: new mongoose.Types.ObjectId(cityId) });
  assert(payout, "No rider payouts found for Bamako. Seed a payout first.");

  const driverId = String(payout.driverId || "");
  assert(driverId, "payout missing driverId.");
  const orderId = String(payout.orderId || "");
  assert(orderId, "payout missing orderId.");
  const weekKey = String(payout.weekKey || getWeekKey());
  const token = createDriverLinkToken(driverId, cityId);
  const qsBase = `cityId=${encodeURIComponent(cityId)}&token=${encodeURIComponent(token)}`;

  const [summary, pending, paid, preview] = await Promise.all([
    request(`/api/driver/earnings/summary?${qsBase}&weekKey=${encodeURIComponent(weekKey)}`),
    request(`/api/driver/payouts/pending?${qsBase}&weekKey=${encodeURIComponent(weekKey)}`),
    request(`/api/driver/payouts/paid?${qsBase}`),
    request(`/api/driver/reconciliation/preview?${qsBase}&weekKey=${encodeURIComponent(weekKey)}`),
  ]);

  assert(summary.res.ok && summary.json?.ok, `summary failed: ${summary.text}`);
  assert(pending.res.ok && pending.json?.ok, `pending failed: ${pending.text}`);
  assert(paid.res.ok && paid.json?.ok, `paid failed: ${paid.text}`);
  assert(preview.res.ok && preview.json?.ok, `preview failed: ${preview.text}`);

  assert(typeof summary.json?.pendingAmount === "number", "pendingAmount missing");
  assert(typeof summary.json?.paidAmount === "number", "paidAmount missing");
  assert(typeof preview.json?.netSettlement === "number", "netSettlement missing");

  const pendingRows = Array.isArray(pending.json?.rows) ? pending.json.rows : [];
  if (pendingRows.length) {
    assert(typeof pendingRows[0].orderNumber === "string", "pending row shape invalid");
  }

  const pendingCsv = await request(
    `/api/driver/payouts/pending/export.csv?${qsBase}&weekKey=${encodeURIComponent(weekKey)}`
  );
  assert(pendingCsv.res.ok, `pending csv failed: ${pendingCsv.text}`);
  const pendingLines = pendingCsv.text.split(/\r?\n/).filter(Boolean);
  assert(
    pendingLines[0].startsWith("orderNumber,businessName,amount"),
    "pending CSV header mismatch"
  );
  if (pendingRows.length) {
    assert(pendingLines.length >= 2, "pending CSV should have at least 2 lines when pending exists");
  }

  const reconCsv = await request(
    `/api/driver/reconciliation/export.csv?${qsBase}&weekKey=${encodeURIComponent(weekKey)}`
  );
  assert(reconCsv.res.ok, `reconciliation csv failed: ${reconCsv.text}`);
  const reconLines = reconCsv.text.split(/\r?\n/).filter(Boolean);
  assert(
    reconLines[0].startsWith("orderNumber,deliveryFeeCharged,riderPayoutAmount"),
    "reconciliation CSV header mismatch"
  );

  const template = await request(
    `/api/ops/dispatch/whatsapp-template?key=${encodeURIComponent(adminKey)}`,
    {
      method: "POST",
      body: { orderId },
    }
  );
  assert(template.res.ok && template.json?.ok, `whatsapp-template failed: ${template.text}`);
  assert(
    String(template.json?.driverLinkUrl || "").includes("/driver"),
    "driverLinkUrl must include /driver"
  );
  const orderDoc = await mongoose.connection.db
    .collection("orders")
    .findOne({ _id: new mongoose.Types.ObjectId(orderId) }, { projection: { orderNumber: 1 } });
  const orderNumber = String(orderDoc?.orderNumber || "");
  assert(
    String(template.json?.messageText || "").includes(orderNumber),
    "messageText must include orderNumber"
  );

  console.log(
    JSON.stringify(
      {
        cityId,
        driverId,
        orderId,
        weekKey,
        pendingCount: pendingRows.length,
        pendingCsvLines: pendingLines.length,
        reconCsvLines: reconLines.length,
        netSettlement: preview.json?.netSettlement,
        driverLinkUrl: template.json?.driverLinkUrl,
      },
      null,
      2
    )
  );
  console.log("Smoke phase3-driver-dashboard passed.");
}

main()
  .catch((error) => {
    console.error(
      "Smoke phase3-driver-dashboard failed:",
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
