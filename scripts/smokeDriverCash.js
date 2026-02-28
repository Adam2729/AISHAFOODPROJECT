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

async function findOrderByNumber(cookie, orderNumber) {
  const list = await requestJson("/api/merchant/orders", { cookie });
  assert(list.res.ok, "Failed to list merchant orders.");
  const rows = Array.isArray(list.json?.orders) ? list.json.orders : [];
  const target = rows.find((row) => String(row?.orderNumber || "") === orderNumber);
  assert(target?._id, "Order not found in merchant orders.");
  return target;
}

async function getHandoff(weekKey, orderId) {
  const list = await requestJson(
    `/api/admin/driver-cash?key=${encodeURIComponent(adminKey)}&weekKey=${encodeURIComponent(weekKey)}&limit=1000`
  );
  assert(list.res.ok, "Failed to list driver cash handoffs.");
  const rows = Array.isArray(list.json?.rows) ? list.json.rows : [];
  return rows.find((row) => String(row?.orderId || "") === orderId) || null;
}

async function main() {
  console.log(`Running driver cash smoke against ${baseUrl}`);

  const health = await requestJson("/api/health");
  assert(health.res.ok, "Health check failed.");

  await requestJson(`/api/admin/maintenance?key=${encodeURIComponent(adminKey)}`, {
    method: "POST",
    body: { enabled: false },
  });

  const pin = "1234";
  const businessCreate = await requestJson(`/api/admin/businesses?key=${encodeURIComponent(adminKey)}`, {
    method: "POST",
    body: {
      type: "restaurant",
      name: randomLabel("DriverCashBiz"),
      phone: "8095557201",
      whatsapp: "18095557201",
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
  assert(forceOpenSettings.res.ok, "Failed to set 24/7 merchant hours.");

  const productCreate = await requestJson("/api/merchant/products", {
    method: "POST",
    cookie: merchantCookie,
    body: {
      name: randomLabel("DriverCashProduct"),
      price: 280,
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
      customerName: "Smoke Driver Cash Customer",
      phone: "8095557202",
      address: "Naco, Santo Domingo",
      lat: 18.5208,
      lng: -69.9588,
      businessId,
      items: [{ productId, qty: 1 }],
    },
  });
  assert(orderCreate.res.status === 201, "Order create failed.");
  const orderNumber = String(orderCreate.json?.orderNumber || "");
  assert(orderNumber, "Missing orderNumber.");

  const orderRow = await findOrderByNumber(merchantCookie, orderNumber);
  const orderId = String(orderRow._id || "");
  assert(orderId, "Missing orderId.");

  const driverCreate = await requestJson(`/api/admin/drivers?key=${encodeURIComponent(adminKey)}`, {
    method: "POST",
    body: {
      name: randomLabel("DriverCashDriver"),
      phoneE164: "18095557203",
      zoneLabel: "Piantini/Naco",
      isActive: true,
    },
  });
  assert(driverCreate.res.status === 201, "Driver creation failed.");
  const driverId = String(driverCreate.json?.driver?.id || "");
  assert(driverId, "Missing driverId.");

  const assign = await requestJson(`/api/admin/dispatch/assign?key=${encodeURIComponent(adminKey)}`, {
    method: "POST",
    body: {
      orderId,
      driverId,
      confirm: "ASSIGN",
    },
  });
  assert(assign.res.ok, "Dispatch assign failed.");

  const linkRes = await requestJson(`/api/admin/drivers?key=${encodeURIComponent(adminKey)}`, {
    method: "PATCH",
    body: {
      action: "generate_link",
      driverId,
      confirm: "REVEAL LINK",
    },
  });
  assert(linkRes.res.ok, "Driver link generation failed.");
  const driverToken = String(linkRes.json?.token || "");
  assert(driverToken, "Missing driver token.");

  const firstDelivered = await requestJson(`/api/driver/orders/delivered?token=${encodeURIComponent(driverToken)}`, {
    method: "POST",
    body: { orderId, cashCollected: true },
  });
  assert(firstDelivered.res.ok, "First driver delivered confirm failed.");
  assert(firstDelivered.json?.handoff?.created === true, "Handoff should be created on first delivery confirm.");

  const weekKey = getWeekKey(new Date());
  const firstHandoff = await getHandoff(weekKey, orderId);
  assert(firstHandoff, "Handoff row not found after first delivery.");
  const firstAmount = Number(firstHandoff.amountCollectedRdp || 0);
  const firstCollectedAt = String(firstHandoff.collectedAt || "");
  assert(firstAmount > 0, "Handoff amount should be > 0.");
  assert(firstCollectedAt, "Handoff collectedAt missing.");

  const secondDelivered = await requestJson(`/api/driver/orders/delivered?token=${encodeURIComponent(driverToken)}`, {
    method: "POST",
    body: { orderId, cashCollected: true },
  });
  assert(secondDelivered.res.ok, "Second driver delivered confirm failed.");
  assert(secondDelivered.json?.handoff?.created === false, "Second delivery confirm must be idempotent.");

  const secondHandoff = await getHandoff(weekKey, orderId);
  assert(secondHandoff, "Handoff row missing after second delivery.");
  assert(Number(secondHandoff.amountCollectedRdp || 0) === firstAmount, "Handoff amount changed on idempotent call.");
  assert(String(secondHandoff.collectedAt || "") === firstCollectedAt, "Handoff collectedAt changed on idempotent call.");

  const markHanded = await requestJson(`/api/admin/driver-cash/mark-handed?key=${encodeURIComponent(adminKey)}`, {
    method: "POST",
    body: {
      orderId,
      handedToMerchantBy: "Smoke Ops",
      receiptRef: "CASH-REF-SMOKE",
      confirm: "HANDOFF",
    },
  });
  assert(markHanded.res.ok, "Admin mark-handed failed.");
  assert(String(markHanded.json?.handoff?.status || "") === "handed_to_merchant", "Handoff status should be handed_to_merchant.");

  const openDispute = await requestJson(`/api/admin/driver-cash/dispute/open?key=${encodeURIComponent(adminKey)}`, {
    method: "POST",
    body: {
      orderId,
      reason: "Smoke dispute: merchant reported short handoff.",
      confirm: "DISPUTE",
    },
  });
  assert(openDispute.res.ok, "Open dispute failed.");
  assert(String(openDispute.json?.handoff?.status || "") === "disputed", "Status should be disputed.");

  const resolveWriteoff = await requestJson(
    `/api/admin/driver-cash/dispute/resolve?key=${encodeURIComponent(adminKey)}`,
    {
      method: "POST",
      body: {
        orderId,
        resolution: "writeoff",
        note: "Smoke writeoff path",
        confirm: "RESOLVE",
      },
    }
  );
  assert(resolveWriteoff.res.ok, "Resolve writeoff failed.");
  assert(String(resolveWriteoff.json?.handoff?.status || "") === "void", "Status should be void after writeoff.");

  const compute = await requestJson(
    `/api/admin/cash-collections/compute?key=${encodeURIComponent(adminKey)}&weekKey=${encodeURIComponent(
      weekKey
    )}&businessId=${encodeURIComponent(businessId)}`
  );
  assert(compute.res.ok, "Cash collection compute failed.");

  const cashCollections = await requestJson(
    `/api/admin/cash-collections?key=${encodeURIComponent(adminKey)}&weekKey=${encodeURIComponent(
      weekKey
    )}&limit=200`
  );
  assert(cashCollections.res.ok, "Cash collections list failed.");
  const rows = Array.isArray(cashCollections.json?.rows) ? cashCollections.json.rows : [];
  const row = rows.find((item) => String(item.businessId || "") === businessId);
  assert(row, "Expected business row in cash collections list.");
  assert(
    row?.driverCash && typeof row.driverCash.driverCollectedTotalRdp === "number",
    "driverCash fields missing from cash collection row."
  );

  console.log("Smoke driver cash passed.");
  console.log(
    JSON.stringify(
      {
        businessId,
        orderId,
        driverId,
        weekKey,
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error("Smoke driver cash failed:", error instanceof Error ? error.message : String(error));
  process.exit(1);
});
