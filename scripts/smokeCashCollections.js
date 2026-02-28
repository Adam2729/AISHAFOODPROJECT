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

if (!adminKey) {
  console.error("Missing ADMIN_KEY env var.");
  process.exit(1);
}

function randomLabel(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
}

function parseCookieHeader(setCookie) {
  if (!setCookie) return "";
  const first = String(setCookie).split(",")[0];
  return first.split(";")[0].trim();
}

function getWeekKey(dateInput = new Date()) {
  const date = new Date(Date.UTC(dateInput.getUTCFullYear(), dateInput.getUTCMonth(), dateInput.getUTCDate()));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((date.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

async function requestJson(pathname, options) {
  const method = options?.method || "GET";
  const headers = {
    "Content-Type": "application/json",
  };
  if (options?.cookie) headers.Cookie = options.cookie;

  const res = await fetch(`${baseUrl}${pathname}`, {
    method,
    headers,
    body: options?.body ? JSON.stringify(options.body) : undefined,
  });

  const text = await res.text();
  const json = text ? JSON.parse(text) : {};
  return { res, json };
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function updateOrderStatus(cookie, orderId, status) {
  const patch = await requestJson(`/api/merchant/orders/${encodeURIComponent(orderId)}`, {
    method: "PATCH",
    cookie,
    body: { status },
  });
  assert(patch.res.ok, `Failed status transition to ${status}.`);
}

async function findOrderIdByOrderNumber(cookie, orderNumber) {
  const merchantOrders = await requestJson("/api/merchant/orders", { cookie });
  assert(merchantOrders.res.ok, "Failed to list merchant orders.");
  const rows = Array.isArray(merchantOrders.json?.orders) ? merchantOrders.json.orders : [];
  const target = rows.find((row) => String(row?.orderNumber || "") === orderNumber);
  const orderId = String(target?._id || "");
  assert(orderId, `Order ${orderNumber} not found in merchant orders.`);
  return orderId;
}

function allDayWeekly() {
  const openDay = { open: "00:00", close: "23:59", closed: false };
  return {
    mon: openDay,
    tue: openDay,
    wed: openDay,
    thu: openDay,
    fri: openDay,
    sat: openDay,
    sun: openDay,
  };
}

async function main() {
  console.log(`Running cash collections smoke against ${baseUrl}`);

  const health = await requestJson("/api/health");
  assert(health.res.ok, "Health check failed.");

  await requestJson(`/api/admin/maintenance?key=${encodeURIComponent(adminKey)}`, {
    method: "POST",
    body: { enabled: false },
  });
  await requestJson(`/api/admin/settings/bool?key=${encodeURIComponent(adminKey)}`, {
    method: "POST",
    body: { key: "pilot_allowlist_enabled", value: false },
  });

  const pin = "1234";
  const businessCreate = await requestJson(`/api/admin/businesses?key=${encodeURIComponent(adminKey)}`, {
    method: "POST",
    body: {
      type: "restaurant",
      name: randomLabel("CashBiz"),
      phone: "8095553201",
      whatsapp: "18095553201",
      address: "Naco, Santo Domingo",
      lat: 18.5204,
      lng: -69.959,
      pin,
    },
  });
  assert(businessCreate.res.status === 201, "Business creation failed.");
  const businessId = String(businessCreate.json?.business?._id || "");
  assert(businessId, "Missing businessId.");

  const loginRes = await fetch(`${baseUrl}/api/merchant/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ businessId, pin }),
  });
  const loginJson = await loginRes.json();
  assert(loginRes.ok, "Merchant login failed.");
  let merchantCookie = parseCookieHeader(loginRes.headers.get("set-cookie"));
  assert(merchantCookie, "Merchant cookie missing.");

  if (Boolean(loginJson.mustChangePin)) {
    const newPin = "5678";
    const setPin = await requestJson("/api/merchant/auth/set-pin", {
      method: "POST",
      cookie: merchantCookie,
      body: { newPin, confirmPin: newPin },
    });
    assert(setPin.res.ok, "set-pin failed.");
    const relogin = await fetch(`${baseUrl}/api/merchant/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ businessId, pin: newPin }),
    });
    assert(relogin.ok, "Merchant re-login failed.");
    merchantCookie = parseCookieHeader(relogin.headers.get("set-cookie"));
    assert(merchantCookie, "Merchant cookie missing after re-login.");
  }

  const forceOpenSettings = await requestJson("/api/merchant/business/settings", {
    method: "PATCH",
    cookie: merchantCookie,
    body: {
      isManuallyPaused: false,
      hours: {
        timezone: "America/Santo_Domingo",
        weekly: allDayWeekly(),
      },
    },
  });
  assert(forceOpenSettings.res.ok, "Failed to set 24/7 merchant hours for smoke.");

  const productCreate = await requestJson("/api/merchant/products", {
    method: "POST",
    cookie: merchantCookie,
    body: {
      name: randomLabel("CashProduct"),
      price: 200,
      category: "Platos",
      isAvailable: true,
    },
  });
  assert(productCreate.res.status === 201, "Product creation failed.");
  const productId = String(productCreate.json?.product?._id || "");
  assert(productId, "Missing productId.");

  const orderCreate = await requestJson("/api/public/orders", {
    method: "POST",
    body: {
      customerName: "Smoke Cash Customer",
      phone: "8095553202",
      address: "Naco, Santo Domingo",
      lat: 18.5208,
      lng: -69.9588,
      businessId,
      items: [{ productId, qty: 1 }],
    },
  });
  assert(orderCreate.res.status === 201, `Public order create failed (${orderCreate.res.status}).`);
  const orderNumber = String(orderCreate.json?.orderNumber || "");
  assert(orderNumber, "Missing orderNumber.");

  const orderId = await findOrderIdByOrderNumber(merchantCookie, orderNumber);
  for (const status of ["accepted", "preparing", "ready", "delivered"]) {
    await updateOrderStatus(merchantCookie, orderId, status);
  }

  const weekKey = getWeekKey(new Date());
  const computeExpected = await requestJson(
    `/api/admin/cash-collections/compute?key=${encodeURIComponent(adminKey)}&weekKey=${encodeURIComponent(
      weekKey
    )}&businessId=${encodeURIComponent(businessId)}`
  );
  assert(computeExpected.res.ok, "Cash compute endpoint failed.");

  const merchantSheet = await requestJson(
    `/api/merchant/cash-collections?weekKey=${encodeURIComponent(weekKey)}`,
    { cookie: merchantCookie }
  );
  assert(merchantSheet.res.ok, "Merchant cash sheet endpoint failed.");
  const expectedNet = Number(merchantSheet.json?.cashCollection?.expected?.netSubtotal || 0);
  const expectedOrders = Number(merchantSheet.json?.cashCollection?.expected?.ordersCount || 0);
  assert(expectedOrders >= 1, "Expected orders should be >= 1 after delivery.");

  const submit = await requestJson("/api/merchant/cash-collections/submit", {
    method: "POST",
    cookie: merchantCookie,
    body: {
      weekKey,
      cashCollected: expectedNet,
      ordersCount: expectedOrders,
      receiptRef: "SMOKE-REC-1",
      collectorName: "Smoke Collector",
      collectionMethod: "in_person",
      note: "Smoke submit",
      confirm: "SUBMIT",
    },
  });
  assert(submit.res.ok, "Merchant submit failed.");
  assert(String(submit.json?.cashCollection?.status || "") === "submitted", "Status should be submitted.");

  const verify = await requestJson(`/api/admin/cash-collections/verify?key=${encodeURIComponent(adminKey)}`, {
    method: "POST",
    body: {
      businessId,
      weekKey,
      action: "verify",
      confirm: "VERIFY",
    },
  });
  assert(verify.res.ok, "Admin verify failed.");
  assert(String(verify.json?.cashCollection?.status || "") === "verified", "Status should be verified.");

  const close = await requestJson(`/api/admin/cash-collections/verify?key=${encodeURIComponent(adminKey)}`, {
    method: "POST",
    body: {
      businessId,
      weekKey,
      action: "close",
      note: "Smoke close",
      confirm: "VERIFY",
    },
  });
  assert(close.res.ok, "Admin close failed.");
  assert(String(close.json?.cashCollection?.status || "") === "closed", "Status should be closed.");

  const resubmitAfterClosed = await requestJson("/api/merchant/cash-collections/submit", {
    method: "POST",
    cookie: merchantCookie,
    body: {
      weekKey,
      cashCollected: expectedNet,
      ordersCount: expectedOrders,
      confirm: "SUBMIT",
    },
  });
  assert(resubmitAfterClosed.res.status === 409, "Resubmit after closed should return 409.");

  const audits = await requestJson(
    `/api/admin/cash-collections/audits?key=${encodeURIComponent(adminKey)}&businessId=${encodeURIComponent(
      businessId
    )}&weekKey=${encodeURIComponent(weekKey)}&limit=20`
  );
  assert(audits.res.ok, "Cash audits endpoint failed.");
  const auditRows = Array.isArray(audits.json?.audits) ? audits.json.audits : [];
  assert(auditRows.length >= 3, "Expected at least 3 audit rows.");
  const auditActions = new Set(auditRows.map((row) => String(row.action || "")));
  assert(auditActions.has("EXPECTED_COMPUTED"), "Missing EXPECTED_COMPUTED audit.");
  assert(auditActions.has("MERCHANT_SUBMITTED"), "Missing MERCHANT_SUBMITTED audit.");
  assert(auditActions.has("ADMIN_VERIFIED"), "Missing ADMIN_VERIFIED audit.");
  assert(auditActions.has("ADMIN_CLOSED"), "Missing ADMIN_CLOSED audit.");

  const list = await requestJson(
    `/api/admin/cash-collections?key=${encodeURIComponent(adminKey)}&weekKey=${encodeURIComponent(
      weekKey
    )}&q=${encodeURIComponent(String(businessCreate.json?.business?.name || ""))}`
  );
  assert(list.res.ok, "Cash list endpoint failed.");
  const row = (Array.isArray(list.json?.rows) ? list.json.rows : []).find(
    (item) => String(item.businessId || "") === businessId
  );
  assert(row, "Expected business row in cash collections list.");
  assert(String(row?.integrity?.expectedHash || "").length > 20, "expectedHash missing from list row.");

  console.log("Smoke cash collections passed.");
  console.log(
    JSON.stringify(
      {
        businessId,
        orderId,
        weekKey,
        cashCollectionId: String(row.id || ""),
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error("Smoke cash collections failed:", error instanceof Error ? error.message : String(error));
  process.exit(1);
});
