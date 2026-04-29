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
    // Env may already be injected by runtime.
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

function randomLabel(prefix) {
  const n = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `${prefix}-${Date.now()}-${n}`;
}

function parseCookieHeader(setCookie) {
  if (!setCookie) return "";
  const first = setCookie.split(",")[0];
  return first.split(";")[0].trim();
}

function toId(value) {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (typeof value === "object" && typeof value.$oid === "string") return value.$oid;
  return String(value);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function request(pathname, options) {
  const method = options?.method || "GET";
  const headers = {
    "Content-Type": options?.contentType || "application/json",
  };
  if (options?.cookie) headers.Cookie = options.cookie;
  if (options?.headers) Object.assign(headers, options.headers);

  const res = await fetch(`${baseUrl}${pathname}`, {
    method,
    headers,
    body: options?.rawBody ?? (options?.body ? JSON.stringify(options.body) : undefined),
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { res, json, text };
}

async function expectApiConflict(pathname, body, expectedCode, cookie) {
  const { res, json } = await request(pathname, {
    method: "PATCH",
    cookie,
    body,
  });
  assert(res.status === 409, `Expected 409, got ${res.status}.`);
  assert(
    String(json?.error?.code || "") === expectedCode,
    `Expected error code ${expectedCode}, got ${String(json?.error?.code || "")}.`
  );
}

async function runCheck(name, fn) {
  process.stdout.write(`- ${name} ... `);
  await fn();
  process.stdout.write("OK\n");
}

async function ensureMongoConnection() {
  if (mongoose.connection.readyState === 1) return;
  assert(!!mongoUri, "MONGODB_URI is required for tamper simulation.");
  await mongoose.connect(mongoUri);
}

async function main() {
  console.log(`Running Step 9 integrity smoke against ${baseUrl}`);

  const health = await request("/api/health");
  assert(health.res.ok, "Health check failed.");

  const maintenanceOff = await request(`/api/admin/maintenance?key=${encodeURIComponent(adminKey)}`, {
    method: "POST",
    body: { enabled: false },
  });
  assert(maintenanceOff.res.ok, "Failed to disable maintenance mode.");

  // Prevent Pilot mode from blocking this smoke run.
  await request(`/api/admin/settings/bool?key=${encodeURIComponent(adminKey)}`, {
    method: "POST",
    body: { key: "pilot_mode", value: false },
  });

  const pin = "1234";
  const businessName = randomLabel("IntegrityBiz");
  const businessBody = {
    type: "restaurant",
    name: businessName,
    phone: `809${String(Date.now()).slice(-7)}`,
    whatsapp: `1809${String(Date.now()).slice(-7)}`,
    address: "Naco, Santo Domingo",
    lat: 18.5209,
    lng: -69.9589,
    pin,
  };
  const createdBusiness = await request(`/api/admin/businesses?key=${encodeURIComponent(adminKey)}`, {
    method: "POST",
    body: businessBody,
  });
  assert(createdBusiness.res.status === 201, "Business creation failed.");
  const businessId = String(createdBusiness.json?.business?._id || "");
  assert(!!businessId, "Business ID missing from create response.");

  const loginRes = await fetch(`${baseUrl}/api/merchant/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ businessId, pin }),
  });
  const loginJson = await loginRes.json();
  assert(loginRes.ok, "Merchant login failed.");
  let merchantCookie = parseCookieHeader(loginRes.headers.get("set-cookie"));
  assert(!!merchantCookie, "Merchant session cookie missing.");

  if (Boolean(loginJson.mustChangePin)) {
    const newPin = "5678";
    const setPin = await request("/api/merchant/auth/set-pin", {
      method: "POST",
      cookie: merchantCookie,
      body: { newPin, confirmPin: newPin },
    });
    assert(setPin.res.ok, "Initial PIN change failed.");

    const relogin = await fetch(`${baseUrl}/api/merchant/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ businessId, pin: newPin }),
    });
    assert(relogin.ok, "Merchant re-login after PIN change failed.");
    merchantCookie = parseCookieHeader(relogin.headers.get("set-cookie"));
    assert(!!merchantCookie, "Merchant session cookie missing after PIN change.");
  }

  const createdProduct = await request("/api/merchant/products", {
    method: "POST",
    cookie: merchantCookie,
    body: {
      name: randomLabel("IntegrityProduct"),
      price: 275,
      category: "Sandwiches",
      isAvailable: true,
    },
  });
  assert(createdProduct.res.status === 201, "Product creation failed.");
  const productId = String(createdProduct.json?.product?._id || "");
  assert(!!productId, "Product ID missing.");

  const createdOrder = await request("/api/public/orders", {
    method: "POST",
    body: {
      customerName: "Cliente Integrity",
      phone: "8095552999",
      address: "Piantini, Santo Domingo",
      lat: 18.5211,
      lng: -69.9591,
      businessId,
      items: [{ productId, qty: 1 }],
    },
  });
  assert(createdOrder.res.status === 201, "Public order creation failed.");
  const orderNumber = String(createdOrder.json?.orderNumber || "");
  assert(!!orderNumber, "Order number missing.");

  const merchantOrders = await request("/api/merchant/orders", { cookie: merchantCookie });
  assert(merchantOrders.res.ok, "Failed to list merchant orders.");
  const orders = Array.isArray(merchantOrders.json?.orders) ? merchantOrders.json.orders : [];
  const targetOrder = orders.find((row) => String(row?.orderNumber || "") === orderNumber);
  const orderId = String(targetOrder?._id || "");
  assert(!!orderId, "Order ID missing from merchant orders.");

  for (const status of ["accepted", "preparing", "ready", "delivered"]) {
    const patch = await request(`/api/merchant/orders/${encodeURIComponent(orderId)}`, {
      method: "PATCH",
      cookie: merchantCookie,
      body: { status },
    });
    assert(patch.res.ok, `Failed transition to ${status}.`);
  }

  const settlementsWeek = await request(`/api/admin/settlements?key=${encodeURIComponent(adminKey)}`);
  assert(settlementsWeek.res.ok, "Failed to load settlements.");
  const weekKey = String(settlementsWeek.json?.weekKey || "");
  assert(!!weekKey, "weekKey missing from settlements response.");
  const settlementRows = Array.isArray(settlementsWeek.json?.settlements)
    ? settlementsWeek.json.settlements
    : [];
  const settlementRow = settlementRows.find((row) => toId(row?.businessId) === businessId);
  assert(!!settlementRow, "Settlement row missing.");

  await runCheck("AC1: immutable financial fields after delivery (model guards)", async () => {
    const check = await request(
      `/api/admin/tests/revenue-integrity?key=${encodeURIComponent(adminKey)}`,
      {
        method: "POST",
        body: { orderId },
      }
    );
    if (!check.res.ok) {
      const msg =
        check.json?.error?.message ||
        check.json?.error ||
        check.text ||
        `HTTP ${check.res.status}`;
      const detail = check.json?.error?.details
        ? ` details=${JSON.stringify(check.json.error.details)}`
        : "";
      throw new Error(`Revenue integrity test endpoint failed (${check.res.status}): ${msg}${detail}`);
    }
    assert(Boolean(check.json?.passed), "Model-level immutability checks did not pass.");
  });

  await runCheck("AC2: counted-final status guard (merchant PATCH)", async () => {
    await expectApiConflict(
      `/api/merchant/orders/${encodeURIComponent(orderId)}`,
      { status: "cancelled" },
      "COUNTED_FINAL",
      merchantCookie
    );
  });

  let lockedSettlementId = "";
  let lockedOriginalFeeTotal = Number(settlementRow?.feeTotal || 0);

  await runCheck("AC4: collect writes integrity hash metadata", async () => {
    const collect = await request(`/api/admin/settlements/collect?key=${encodeURIComponent(adminKey)}`, {
      method: "POST",
      body: {
        businessId,
        weekKey,
        receiptRef: randomLabel("cash"),
      },
    });
    assert(collect.res.ok, "Collect settlement failed.");
    const s = collect.json?.settlement;
    assert(!!String(s?.integrityHash || "").trim(), "integrityHash missing after collect.");
    assert(String(s?.integrityHashAlgo || "") === "sha256", "integrityHashAlgo must be sha256 after collect.");
    assert(Number(s?.integrityHashVersion || 0) === 1, "integrityHashVersion must be 1 after collect.");
    assert(!!s?.integrityHashAt, "integrityHashAt missing after collect.");
  });

  await runCheck("AC4: lock writes integrity hash metadata", async () => {
    const lock = await request(`/api/admin/settlements/lock?key=${encodeURIComponent(adminKey)}`, {
      method: "POST",
      body: {
        businessId,
        weekKey,
        confirm: "LOCK",
      },
    });
    assert(lock.res.ok, "Lock settlement failed.");
    const s = lock.json?.settlement;
    assert(String(s?.status || "") === "locked", "Settlement status should be locked.");
    assert(!!String(s?.integrityHash || "").trim(), "integrityHash missing after lock.");
    assert(String(s?.integrityHashAlgo || "") === "sha256", "integrityHashAlgo must be sha256 after lock.");
    assert(Number(s?.integrityHashVersion || 0) === 1, "integrityHashVersion must be 1 after lock.");
    assert(!!s?.integrityHashAt, "integrityHashAt missing after lock.");
    lockedSettlementId = String(s?._id || "");
    lockedOriginalFeeTotal = Number(s?.feeTotal || 0);
  });

  await runCheck("AC3: locked settlement blocks resolve", async () => {
    const resolve = await request(`/api/admin/settlements/resolve?key=${encodeURIComponent(adminKey)}`, {
      method: "POST",
      body: {
        businessId,
        weekKey,
        resolutionStatus: "confirmed_correct",
        note: "lock guard check",
        confirm: "RESOLVE",
      },
    });
    assert(resolve.res.status === 409, `Expected 409, got ${resolve.res.status}.`);
    assert(
      String(resolve.json?.error?.code || "") === "SETTLEMENT_LOCKED",
      `Expected SETTLEMENT_LOCKED, got ${String(resolve.json?.error?.code || "")}.`
    );
  });

  await runCheck("AC5: recompute returns integrity block", async () => {
    const recompute = await request(`/api/admin/settlements/recompute?key=${encodeURIComponent(adminKey)}`, {
      method: "POST",
      body: { businessId, weekKey },
    });
    assert(recompute.res.ok, "Recompute failed.");
    const integrity = recompute.json?.integrity || {};
    assert(typeof integrity.hasHash === "boolean", "integrity.hasHash must be boolean.");
    assert(
      integrity.hashMatches === null || typeof integrity.hashMatches === "boolean",
      "integrity.hashMatches must be boolean|null."
    );
    assert(Object.prototype.hasOwnProperty.call(integrity, "storedHash"), "integrity.storedHash missing.");
    assert(Object.prototype.hasOwnProperty.call(integrity, "expectedHash"), "integrity.expectedHash missing.");
  });

  await runCheck("AC6: forced tamper triggers integrity mismatch in previews + Ops badge", async () => {
    assert(!!lockedSettlementId, "Missing locked settlement ID for tamper test.");
    await ensureMongoConnection();
    const settlementObjectId = new mongoose.Types.ObjectId(lockedSettlementId);
    try {
      await mongoose.connection.collection("settlements").updateOne(
        { _id: settlementObjectId },
        { $set: { feeTotal: lockedOriginalFeeTotal + 17.25 } }
      );

      const runPreviews = await request(
        `/api/admin/jobs/settlement-previews?key=${encodeURIComponent(adminKey)}&weekKey=${encodeURIComponent(weekKey)}`,
        { method: "POST" }
      );
      assert(runPreviews.res.ok, "Preview generation failed after tamper.");

      const previews = await request(
        `/api/admin/settlement-previews?key=${encodeURIComponent(adminKey)}&weekKey=${encodeURIComponent(
          weekKey
        )}&mismatchOnly=true&limit=50`
      );
      assert(previews.res.ok, "Failed to read settlement previews.");
      const previewRows = Array.isArray(previews.json?.previews) ? previews.json.previews : [];
      const row = previewRows.find((item) => toId(item?.businessId) === businessId);
      assert(!!row, "Tampered business not found in mismatch previews.");
      assert(row.integrityHashMatches === false, "Expected integrityHashMatches=false after tamper.");

      const opsHtml = await request(`/admin/ops?key=${encodeURIComponent(adminKey)}`, {
        method: "GET",
        contentType: "text/html",
      });
      assert(opsHtml.res.ok, "Failed to load /admin/ops.");
      assert(
        opsHtml.text.includes("INTEGRITY FAIL"),
        'Expected "INTEGRITY FAIL" badge in /admin/ops HTML.'
      );
    } finally {
      // Cleanup tamper side effect.
      await mongoose.connection.collection("settlements").updateOne(
        { _id: settlementObjectId },
        { $set: { feeTotal: lockedOriginalFeeTotal } }
      );
      await request(
        `/api/admin/jobs/settlement-previews?key=${encodeURIComponent(adminKey)}&weekKey=${encodeURIComponent(weekKey)}`,
        { method: "POST" }
      );
    }
  });

  console.log("Step 9 integrity smoke passed.");
  console.log(
    JSON.stringify(
      {
        businessId,
        orderId,
        weekKey,
        settlementId: lockedSettlementId,
      },
      null,
      2
    )
  );
}

main().catch((err) => {
  console.error("Step 9 integrity smoke failed:", err instanceof Error ? err.message : String(err));
  process.exit(1);
});
