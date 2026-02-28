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

async function createAndDeliverOrder({ businessId, productId, phone, merchantCookie }) {
  const createOrder = await requestJson("/api/public/orders", {
    method: "POST",
    body: {
      customerName: "Smoke Review Customer",
      phone,
      address: "Naco, Santo Domingo",
      lat: 18.5208,
      lng: -69.9588,
      businessId,
      items: [{ productId, qty: 1 }],
    },
  });
  assert(createOrder.res.status === 201, `Public order create failed (${createOrder.res.status}).`);
  const orderNumber = String(createOrder.json?.orderNumber || "");
  assert(orderNumber, "Missing orderNumber.");
  const orderId = await findOrderIdByOrderNumber(merchantCookie, orderNumber);
  for (const status of ["accepted", "preparing", "ready", "delivered"]) {
    await updateOrderStatus(merchantCookie, orderId, status);
  }
  return { orderId, orderNumber };
}

async function main() {
  console.log(`Running review smoke against ${baseUrl}`);

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
      name: randomLabel("ReviewBiz"),
      phone: "8095553101",
      whatsapp: "18095553101",
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

  const productCreate = await requestJson("/api/merchant/products", {
    method: "POST",
    cookie: merchantCookie,
    body: {
      name: randomLabel("ReviewProduct"),
      price: 180,
      category: "Platos",
      isAvailable: true,
    },
  });
  assert(productCreate.res.status === 201, "Product creation failed.");
  const productId = String(productCreate.json?.product?._id || "");
  assert(productId, "Missing productId.");

  const ownerPhone = "8095553102";
  const wrongPhone = "8095559999";
  const firstOrder = await createAndDeliverOrder({
    businessId,
    productId,
    phone: ownerPhone,
    merchantCookie,
  });

  const reviewOk = await requestJson("/api/public/reviews", {
    method: "POST",
    body: {
      phone: ownerPhone,
      orderId: firstOrder.orderId,
      rating: 5,
      tags: ["rapido", "rico", "caliente"],
      comment: "Excelente",
      source: "track",
    },
  });
  assert(reviewOk.res.ok && reviewOk.json?.ok, "Review create should succeed.");

  const reviewDuplicate = await requestJson("/api/public/reviews", {
    method: "POST",
    body: {
      phone: ownerPhone,
      orderId: firstOrder.orderId,
      rating: 4,
      source: "history",
    },
  });
  assert(reviewDuplicate.res.status === 409, "Duplicate review should return 409.");
  assert(
    String(reviewDuplicate.json?.error?.code || "") === "ALREADY_REVIEWED",
    "Duplicate review should return ALREADY_REVIEWED."
  );

  const secondOrder = await createAndDeliverOrder({
    businessId,
    productId,
    phone: ownerPhone,
    merchantCookie,
  });
  const reviewWrongPhone = await requestJson("/api/public/reviews", {
    method: "POST",
    body: {
      phone: wrongPhone,
      orderId: secondOrder.orderId,
      rating: 1,
      source: "history",
    },
  });
  assert(reviewWrongPhone.res.status === 403, "Wrong phone review should return 403.");
  assert(
    String(reviewWrongPhone.json?.error?.code || "") === "FORBIDDEN",
    "Wrong phone review should return FORBIDDEN."
  );

  const businesses = await requestJson(
    `/api/public/businesses?lat=18.5205&lng=-69.9590`
  );
  assert(businesses.res.ok, "Business list failed.");
  const listedBusiness = (businesses.json?.businesses || []).find(
    (row) => String(row?.id || "") === businessId
  );
  assert(listedBusiness, "Created business missing from list.");
  assert(
    listedBusiness?.reputation &&
      typeof listedBusiness.reputation.avgRating30d === "number" &&
      typeof listedBusiness.reputation.reviewsCount30d === "number",
    "Business list reputation payload missing."
  );

  const menu = await requestJson(
    `/api/public/businesses/${encodeURIComponent(businessId)}/menu`
  );
  assert(menu.res.ok, "Menu route failed.");
  assert(
    menu.json?.business?.reputation &&
      typeof menu.json.business.reputation.avgRating30d === "number" &&
      typeof menu.json.business.reputation.reviewsCount30d === "number",
    "Menu reputation payload missing."
  );

  console.log("Smoke reviews passed.");
  console.log(
    JSON.stringify(
      {
        businessId,
        productId,
        firstOrderId: firstOrder.orderId,
        secondOrderId: secondOrder.orderId,
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error("Smoke reviews failed:", error instanceof Error ? error.message : String(error));
  process.exit(1);
});

