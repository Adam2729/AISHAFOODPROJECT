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

async function ensureBusinessIdForWeek(weekKey) {
  const mismatch = await requestJson(
    `/api/admin/finance/mismatches?key=${encodeURIComponent(adminKey)}&weekKey=${encodeURIComponent(
      weekKey
    )}&limit=200`
  );
  assert(mismatch.response.ok, "Finance mismatches endpoint failed.");
  const rows = Array.isArray(mismatch.json?.rows) ? mismatch.json.rows : [];
  const withDelivered = rows.find(
    (row) => Number(row?.deliveredAgg?.deliveredOrdersCount || 0) > 0
  );
  if (withDelivered?.businessId) {
    return {
      businessId: String(withDelivered.businessId),
      seeded: false,
    };
  }

  execFileSync("node", ["scripts/smokeFinanceAlignment.js"], {
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
  const afterDelivered = afterRows.find(
    (row) => Number(row?.deliveredAgg?.deliveredOrdersCount || 0) > 0
  );
  if (afterDelivered?.businessId) {
    return {
      businessId: String(afterDelivered.businessId),
      seeded: true,
    };
  }

  return { businessId: "", seeded: true };
}

async function main() {
  console.log(`Running weekly statement smoke against ${baseUrl}`);
  const health = await requestJson("/api/health");
  assert(health.response.ok, "Health check failed.");

  const weekKey = getWeekKey(new Date());

  const compute = await requestJson(
    `/api/admin/jobs/cash-collections-compute?key=${encodeURIComponent(adminKey)}&weekKey=${encodeURIComponent(
      weekKey
    )}`,
    { method: "POST" }
  );
  assert(compute.response.ok, "Cash collection compute job failed.");

  const business = await ensureBusinessIdForWeek(weekKey);
  if (!business.businessId) {
    console.log("No business with delivered+counted orders found for current week. Endpoints are healthy.");
    process.exit(0);
  }

  const jsonRes = await requestJson(
    `/api/admin/statements/weekly?key=${encodeURIComponent(adminKey)}&businessId=${encodeURIComponent(
      business.businessId
    )}&weekKey=${encodeURIComponent(weekKey)}&includeAnomalies=true`
  );
  assert(jsonRes.response.ok, "Admin weekly statement JSON endpoint failed.");
  assert(Boolean(jsonRes.json?.ok), "Admin weekly statement JSON response not ok.");
  assert(Boolean(jsonRes.json?.pack), "Statement pack missing.");
  assert(Number(jsonRes.json?.pack?.totals?.netSubtotal || 0) >= 0, "totals.netSubtotal must be >= 0.");

  const orders = Array.isArray(jsonRes.json?.pack?.orders) ? jsonRes.json.pack.orders : [];
  const ordersCount = Number(jsonRes.json?.pack?.totals?.ordersCount || 0);
  assert(orders.length === ordersCount, "orders length does not match totals.ordersCount.");

  const csvSummaryRes = await request(
    `/api/admin/statements/weekly?key=${encodeURIComponent(adminKey)}&businessId=${encodeURIComponent(
      business.businessId
    )}&weekKey=${encodeURIComponent(weekKey)}&format=csv_summary`
  );
  const csvSummaryText = await csvSummaryRes.text();
  assert(csvSummaryRes.ok, "Statement summary CSV endpoint failed.");
  assert(
    String(csvSummaryRes.headers.get("content-type") || "").toLowerCase().includes("text/csv"),
    "Statement summary CSV content-type invalid."
  );
  assert(csvSummaryText.includes("weekKey,businessId,businessName"), "Summary CSV header missing.");
  assert(csvSummaryText.trim().split("\n").length >= 2, "Summary CSV should have header + one row.");

  const csvOrdersRes = await request(
    `/api/admin/statements/weekly?key=${encodeURIComponent(adminKey)}&businessId=${encodeURIComponent(
      business.businessId
    )}&weekKey=${encodeURIComponent(weekKey)}&format=csv_orders`
  );
  const csvOrdersText = await csvOrdersRes.text();
  assert(csvOrdersRes.ok, "Statement orders CSV endpoint failed.");
  assert(
    String(csvOrdersRes.headers.get("content-type") || "").toLowerCase().includes("text/csv"),
    "Statement orders CSV content-type invalid."
  );
  assert(csvOrdersText.includes("orderId,orderNumber"), "Orders CSV header missing.");
  assert(csvOrdersText.trim().split("\n").length >= 2, "Orders CSV should have header + one row.");

  console.log("Weekly statement smoke passed.");
  console.log(
    JSON.stringify(
      {
        weekKey,
        businessId: business.businessId,
        seeded: business.seeded,
        ordersCount,
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error("Weekly statement smoke failed:", error instanceof Error ? error.message : String(error));
  process.exit(1);
});
