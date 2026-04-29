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

async function findOrderByNumber(cookie, orderNumber) {
  const list = await requestJson("/api/merchant/orders", { cookie });
  assert(list.res.ok, "Failed to list merchant orders.");
  const rows = Array.isArray(list.json?.orders) ? list.json.orders : [];
  const row = rows.find((item) => String(item?.orderNumber || "") === orderNumber);
  assert(row?._id, "Order not found in merchant list.");
  return row;
}

async function updateOrderStatus(cookie, orderId, status, deliveryOtp) {
  const body = { status };
  if (status === "delivered" && deliveryOtp) {
    body.deliveryOtp = deliveryOtp;
  }
  const patch = await requestJson(`/api/merchant/orders/${encodeURIComponent(orderId)}`, {
    method: "PATCH",
    cookie,
    body,
  });
  assert(patch.res.ok, `Failed transition to ${status}.`);
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
  console.log(`Running dispatch smoke against ${baseUrl}`);

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
      name: randomLabel("DispatchBiz"),
      phone: "8095556201",
      whatsapp: "18095556201",
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
      name: randomLabel("DispatchProduct"),
      price: 220,
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
      customerName: "Smoke Dispatch Customer",
      phone: "8095556202",
      address: "Naco, Santo Domingo",
      lat: 18.5208,
      lng: -69.9588,
      businessId,
      items: [{ productId, qty: 1 }],
    },
  });
  assert(orderCreate.res.status === 201, `Order create failed (${orderCreate.res.status}).`);
  const orderNumber = String(orderCreate.json?.orderNumber || "");
  const deliveryOtp = String(orderCreate.json?.deliveryOtp || "");
  assert(orderNumber, "Missing orderNumber.");
  assert(deliveryOtp, "Missing deliveryOtp.");

  const orderRow = await findOrderByNumber(merchantCookie, orderNumber);
  const orderId = String(orderRow._id || "");
  assert(orderId, "Missing orderId.");

  const driverCreate = await requestJson(`/api/admin/drivers?key=${encodeURIComponent(adminKey)}`, {
    method: "POST",
    body: {
      name: randomLabel("DispatchDriver"),
      phoneE164: "18095556203",
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
  assert(String(assign.json?.dispatch?.assignedDriverId || "") === driverId, "Order was not assigned.");
  assert(String(assign.json?.auditId || "").length > 10, "Assign audit missing.");

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

  const driverOrders = await requestJson(`/api/driver/orders?token=${encodeURIComponent(driverToken)}`);
  assert(driverOrders.res.ok, "Driver orders list failed.");
  const assignedOrder = (Array.isArray(driverOrders.json?.orders) ? driverOrders.json.orders : []).find(
    (row) => String(row.orderId || "") === orderId
  );
  assert(assignedOrder, "Assigned order missing in driver orders.");
  assert(!Object.prototype.hasOwnProperty.call(assignedOrder, "phone"), "Driver payload should not include phone.");

  const pickup = await requestJson(`/api/driver/orders/pickup?token=${encodeURIComponent(driverToken)}`, {
    method: "POST",
    body: { orderId },
  });
  assert(pickup.res.ok, "Driver pickup confirm failed.");
  assert(String(pickup.json?.pickupConfirmedAt || "").length > 10, "pickupConfirmedAt missing.");
  assert(String(pickup.json?.auditId || "").length > 10, "Pickup audit missing.");

  const delivered = await requestJson(`/api/driver/orders/delivered?token=${encodeURIComponent(driverToken)}`, {
    method: "POST",
    body: { orderId, cashCollected: true },
  });
  assert(delivered.res.ok, "Driver delivered confirm failed.");
  assert(String(delivered.json?.deliveredConfirmedAt || "").length > 10, "deliveredConfirmedAt missing.");
  assert(delivered.json?.cashCollectedByDriver === true, "cashCollectedByDriver should be true.");
  assert(String(delivered.json?.auditId || "").length > 10, "Delivered audit missing.");

  const afterDriverConfirm = await findOrderByNumber(merchantCookie, orderNumber);
  assert(
    String(afterDriverConfirm.status || "") !== "delivered",
    "Driver endpoint should not auto-mark order as delivered."
  );
  assert(
    !Boolean(afterDriverConfirm?.settlement?.counted),
    "Settlement should not be counted before merchant delivery."
  );

  for (const status of ["accepted", "preparing", "ready", "delivered"]) {
    await updateOrderStatus(
      merchantCookie,
      orderId,
      status,
      status === "delivered" ? deliveryOtp : undefined
    );
  }

  const afterMerchantDelivered = await findOrderByNumber(merchantCookie, orderNumber);
  assert(String(afterMerchantDelivered.status || "") === "delivered", "Merchant delivery did not finalize order.");
  assert(Boolean(afterMerchantDelivered?.settlement?.counted), "Settlement should be counted after merchant delivery.");

  console.log("Smoke dispatch passed.");
  console.log(
    JSON.stringify(
      {
        businessId,
        orderId,
        driverId,
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error("Smoke dispatch failed:", error instanceof Error ? error.message : String(error));
  process.exit(1);
});
