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
    // no-op
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

async function ensureBusinessWithOrders(weekKey) {
  const mismatch = await requestJson(
    `/api/admin/finance/mismatches?key=${encodeURIComponent(adminKey)}&weekKey=${encodeURIComponent(
      weekKey
    )}&limit=200`
  );
  assert(mismatch.response.ok, "Finance mismatches endpoint failed.");
  const rows = Array.isArray(mismatch.json?.rows) ? mismatch.json.rows : [];
  const candidate = rows.find((row) => Number(row?.deliveredAgg?.deliveredOrdersCount || 0) > 0);
  if (candidate?.businessId) return { businessId: String(candidate.businessId), seeded: false };

  execFileSync("node", ["scripts/smokeWeeklyStatement.js"], {
    stdio: "inherit",
    cwd: process.cwd(),
    env: { ...process.env, SMOKE_BASE_URL: baseUrl, ADMIN_KEY: adminKey },
  });

  const after = await requestJson(
    `/api/admin/finance/mismatches?key=${encodeURIComponent(adminKey)}&weekKey=${encodeURIComponent(
      weekKey
    )}&limit=200`
  );
  assert(after.response.ok, "Finance mismatches endpoint failed after seed.");
  const afterRows = Array.isArray(after.json?.rows) ? after.json.rows : [];
  const afterCandidate = afterRows.find((row) => Number(row?.deliveredAgg?.deliveredOrdersCount || 0) > 0);
  return {
    businessId: afterCandidate?.businessId ? String(afterCandidate.businessId) : "",
    seeded: true,
  };
}

async function main() {
  console.log(`Running statement PDF smoke against ${baseUrl}`);

  const health = await requestJson("/api/health");
  assert(health.response.ok, "Health check failed.");

  const weekKey = getWeekKey(new Date());
  const ensured = await ensureBusinessWithOrders(weekKey);
  if (!ensured.businessId) {
    console.log("No business with delivered+counted orders found for this week. Endpoint health verified.");
    process.exit(0);
  }

  const archive = await requestJson(`/api/admin/statements/archive?key=${encodeURIComponent(adminKey)}`, {
    method: "POST",
    body: {
      businessId: ensured.businessId,
      weekKey,
      generatedBy: "admin",
    },
  });
  assert(archive.response.ok, "Statement archive endpoint failed.");
  assert(Boolean(archive.json?.ok), "Statement archive response not ok.");
  const pdfUrl = String(archive.json?.links?.pdf || "");
  assert(Boolean(pdfUrl), "Statement archive did not return pdf link.");

  const pdfRes = await request(pdfUrl, {});
  const pdfBuffer = Buffer.from(await pdfRes.arrayBuffer());
  assert(pdfRes.ok, "Signed PDF download failed.");
  const contentType = String(pdfRes.headers.get("content-type") || "").toLowerCase();
  assert(contentType.includes("application/pdf"), "PDF content-type mismatch.");
  assert(pdfBuffer.byteLength > 2048, "PDF is too small (< 2KB).");

  const ttlOne = await requestJson(`/api/admin/statements/archive?key=${encodeURIComponent(adminKey)}`, {
    method: "POST",
    body: {
      businessId: ensured.businessId,
      weekKey,
      generatedBy: "admin",
      ttlSeconds: 1,
    },
  });
  assert(ttlOne.response.ok, "Statement archive endpoint (ttl=1) failed.");
  const expiringUrl = String(ttlOne.json?.links?.pdf || "");
  assert(Boolean(expiringUrl), "Missing expiring PDF link.");

  await new Promise((resolve) => setTimeout(resolve, 1500));
  const expiredRes = await request(expiringUrl, {});
  assert(expiredRes.status === 401, "Expired token did not return 401.");

  console.log("Statement PDF smoke passed.");
  console.log(
    JSON.stringify(
      {
        weekKey,
        businessId: ensured.businessId,
        seeded: ensured.seeded,
        pdfBytes: pdfBuffer.byteLength,
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error("Statement PDF smoke failed:", error instanceof Error ? error.message : String(error));
  process.exit(1);
});
