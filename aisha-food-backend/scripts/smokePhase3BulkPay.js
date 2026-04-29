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
  const date = new Date(Date.UTC(dateInput.getUTCFullYear(), dateInput.getUTCMonth(), dateInput.getUTCDate()));
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

async function ensurePendingPayouts(db, cityId, weekKey) {
  const existing = await db
    .collection("riderpayouts")
    .find({ cityId: new mongoose.Types.ObjectId(String(cityId)), weekKey, status: "pending" })
    .limit(2)
    .toArray();
  if (existing.length >= 2) return existing.map((p) => String(p._id));

  // Seed synthetic pending payouts for smoke safety
  const now = new Date();
  const needed = 2 - existing.length;
  const seedDocs = Array.from({ length: needed }).map((_, idx) => ({
    cityId: new mongoose.Types.ObjectId(String(cityId)),
    orderId: new mongoose.Types.ObjectId(),
    driverId: new mongoose.Types.ObjectId(),
    driverRef: `SMOKE-BULK-${now.getTime()}-${idx}`,
    businessId: new mongoose.Types.ObjectId(),
    weekKey,
    amount: 1200,
    deliveryFeeCharged: 1400,
    platformMargin: 200,
    status: "pending",
    createdAt: now,
    updatedAt: now,
  }));
  await db.collection("riderpayouts").insertMany(seedDocs, { ordered: true });
  const refreshed = await db
    .collection("riderpayouts")
    .find({ cityId: new mongoose.Types.ObjectId(String(cityId)), weekKey, status: "pending" })
    .limit(5)
    .toArray();
  return refreshed.slice(0, 2).map((p) => String(p._id));
}

function csvHasIds(lines, ids) {
  const body = lines.slice(1).join("\n");
  return ids.some((id) => body.includes(id));
}

async function main() {
  console.log(`Running Phase-3 bulk pay smoke against ${baseUrl}`);

  const health = await request("/api/health");
  assert(health.res.ok, "Health check failed.");

  await request(`/api/admin/jobs/seed-cities?key=${encodeURIComponent(adminKey)}`, {
    method: "POST",
  });

  await mongoose.connect(mongoUri);
  const db = mongoose.connection.db;

  const adminCities = await request(`/api/admin/cities?key=${encodeURIComponent(adminKey)}`);
  assert(adminCities.res.ok && adminCities.json?.ok, "Admin cities failed.");
  const bamako =
    (adminCities.json?.cities || []).find((row) => String(row?.code || "").toUpperCase() === "BKO") ||
    null;
  assert(bamako?._id, "Bamako city missing.");
  const cityId = String(bamako._id);
  const weekKey = getWeekKey(new Date());

  const payoutIds = await ensurePendingPayouts(db, cityId, weekKey);
  assert(payoutIds.length >= 2, "Not enough pending payouts to test bulk pay.");

  const pendingBefore = await request(
    `/api/admin/rider-payouts/pending?key=${encodeURIComponent(adminKey)}&cityId=${encodeURIComponent(
      cityId
    )}&weekKey=${encodeURIComponent(weekKey)}`,
    {
      headers: { "x-city-id": cityId },
    }
  );
  assert(pendingBefore.res.ok && pendingBefore.json?.ok, "Pending list failed.");
  assert(
    Array.isArray(pendingBefore.json?.pending) && pendingBefore.json.pending.length >= 2,
    "Pending list should have at least 2 rows."
  );

  const payRes = await request(`/api/admin/rider-payouts/mark-paid-bulk?key=${encodeURIComponent(adminKey)}`, {
    method: "POST",
    headers: { "x-city-id": cityId },
    body: {
      cityId,
      weekKey,
      payoutIds: payoutIds.slice(0, 2),
      note: "bulk-pay-smoke",
    },
  });
  assert(payRes.res.ok && payRes.json?.ok, `Bulk pay failed: ${payRes.text}`);
  assert(Number(payRes.json?.updatedCount || 0) === 2, "updatedCount should be 2.");

  const pendingAfter = await request(
    `/api/admin/rider-payouts/pending?key=${encodeURIComponent(adminKey)}&cityId=${encodeURIComponent(
      cityId
    )}&weekKey=${encodeURIComponent(weekKey)}`,
    {
      headers: { "x-city-id": cityId },
    }
  );
  assert(pendingAfter.res.ok && pendingAfter.json?.ok, "Pending list after pay failed.");
  const remainingIds = new Set(
    (pendingAfter.json?.pending || []).map((row) => String(row.payoutId || row._id || ""))
  );
  assert(!remainingIds.has(payoutIds[0]) && !remainingIds.has(payoutIds[1]), "Paid payouts still pending.");

  const exportCsv = await request(
    `/api/admin/rider-payouts/pending/export.csv?key=${encodeURIComponent(
      adminKey
    )}&cityId=${encodeURIComponent(cityId)}&weekKey=${encodeURIComponent(weekKey)}`,
    {
      headers: { "x-city-id": cityId },
    }
  );
  assert(exportCsv.res.ok, "Pending export failed.");
  const lines = exportCsv.text.split(/\r?\n/).filter(Boolean);
  assert(lines.length >= 1, "CSV missing header.");
  assert(lines[0].startsWith("payoutId,orderId,driverId,amount"), "CSV header mismatch.");
  assert(!csvHasIds(lines, [payoutIds[0], payoutIds[1]]), "CSV should not include paid payouts.");

  const payAgain = await request(`/api/admin/rider-payouts/mark-paid-bulk?key=${encodeURIComponent(adminKey)}`, {
    method: "POST",
    headers: { "x-city-id": cityId },
    body: {
      cityId,
      weekKey,
      payoutIds: payoutIds.slice(0, 2),
      note: "bulk-pay-smoke-repeat",
    },
  });
  assert(payAgain.res.ok && payAgain.json?.ok, "Second bulk pay failed.");
  assert(Number(payAgain.json?.updatedCount || 0) === 0, "Second bulk pay should be idempotent (0).");

  console.log(
    JSON.stringify(
      {
        cityId,
        weekKey,
        paidIds: payoutIds.slice(0, 2),
        pendingAfter: (pendingAfter.json?.pending || []).length,
        csvLines: lines.length,
      },
      null,
      2
    )
  );
  console.log("Smoke phase3-bulkpay passed.");
}

main()
  .catch((error) => {
    console.error("Smoke phase3-bulkpay failed:", error instanceof Error ? error.message : String(error));
    process.exit(1);
  })
  .finally(async () => {
    try {
      await mongoose.disconnect();
    } catch {
      // no-op
    }
  });
