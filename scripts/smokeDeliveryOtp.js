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
  const row = rows.find((item) => String(item?.orderNumber || "") === orderNumber);
  assert(row?._id, "Order not found in merchant list.");
  return row;
}

async function updateOrderStatus(cookie, orderId, status, deliveryOtp) {
  const body = { status };
  if (status === "delivered" && deliveryOtp) {
    body.deliveryOtp = deliveryOtp;
  }
  return requestJson(`/api/merchant/orders/${encodeURIComponent(orderId)}`, {
    method: "PATCH",
    cookie,
    body,
  });
}

async function setOtpCreatedAtOld(orderId, hoursAgo = 25) {
  if (mongoose.connection.readyState !== 1) {
    await mongoose.connect(mongoUri, { autoIndex: false });
  }
  const db = mongoose.connection.db;
  if (!db) throw new Error("Mongo connection unavailable.");
  const oldDate = new Date(Date.now() - hoursAgo * 60 * 60 * 1000);
  await db.collection("orders").updateOne(
    { _id: new mongoose.Types.ObjectId(orderId) },
    {
      $set: {
        "deliveryProof.otpCreatedAt": oldDate,
      },
    }
  );
}

async function main() {
  console.log(`Running delivery OTP smoke against ${baseUrl}`);

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
      name: randomLabel("OtpBiz"),
      phone: "8095558201",
      whatsapp: "18095558201",
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
      name: randomLabel("OtpProduct"),
      price: 240,
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
      customerName: "Smoke OTP Customer",
      phone: "8095558202",
      address: "Naco, Santo Domingo",
      lat: 18.5208,
      lng: -69.9588,
      businessId,
      items: [{ productId, qty: 1 }],
    },
  });
  assert(orderCreate.res.status === 201, "Order create failed.");
  const orderNumber = String(orderCreate.json?.orderNumber || "");
  const deliveryOtp = String(orderCreate.json?.deliveryOtp || "");
  assert(orderNumber, "Missing orderNumber.");
  assert(/^\d{6}$/.test(deliveryOtp), "Missing deliveryOtp.");

  const orderRow = await findOrderByNumber(merchantCookie, orderNumber);
  const orderId = String(orderRow._id || "");
  assert(orderId, "Missing orderId.");

  for (const status of ["accepted", "preparing", "ready"]) {
    const step = await updateOrderStatus(merchantCookie, orderId, status);
    assert(step.res.ok, `Failed transition to ${status}.`);
  }

  const wrongOtp = deliveryOtp === "000000" ? "999999" : "000000";
  const wrongDelivered = await updateOrderStatus(merchantCookie, orderId, "delivered", wrongOtp);
  assert(wrongDelivered.res.status === 409, "Wrong OTP should return 409.");
  assert(
    String(wrongDelivered.json?.error?.code || "") === "DELIVERY_OTP_INVALID",
    "Wrong OTP should return DELIVERY_OTP_INVALID."
  );

  const correctDelivered = await updateOrderStatus(merchantCookie, orderId, "delivered", deliveryOtp);
  assert(correctDelivered.res.ok, "Correct OTP delivery failed.");
  assert(
    Boolean(correctDelivered.json?.order?.settlement?.counted),
    "Settlement should be counted after OTP-verified delivery."
  );

  const track = await requestJson(
    `/api/public/track?orderNumber=${encodeURIComponent(orderNumber)}&phone=${encodeURIComponent(
      "8095558202"
    )}`
  );
  assert(track.res.ok, "Track failed.");
  assert(
    String(track.json?.order?.deliveryProof?.verifiedAt || "").length > 10,
    "Track should show deliveryProof.verifiedAt."
  );

  const orderCreateExpired = await requestJson("/api/public/orders", {
    method: "POST",
    body: {
      customerName: "Smoke OTP Expired",
      phone: "8095558203",
      address: "Naco, Santo Domingo",
      lat: 18.5208,
      lng: -69.9588,
      businessId,
      items: [{ productId, qty: 1 }],
    },
  });
  assert(orderCreateExpired.res.status === 201, "Expired-path order create failed.");
  const expiredOrderNumber = String(orderCreateExpired.json?.orderNumber || "");
  const expiredOrderOtp = String(orderCreateExpired.json?.deliveryOtp || "");
  assert(expiredOrderNumber && expiredOrderOtp, "Expired-path order data missing.");

  const expiredOrderRow = await findOrderByNumber(merchantCookie, expiredOrderNumber);
  const expiredOrderId = String(expiredOrderRow._id || "");
  assert(expiredOrderId, "Missing expired-path orderId.");

  for (const status of ["accepted", "preparing", "ready"]) {
    const step = await updateOrderStatus(merchantCookie, expiredOrderId, status);
    assert(step.res.ok, `Failed transition to ${status} (expired path).`);
  }

  await setOtpCreatedAtOld(expiredOrderId, 25);

  const expiredDelivered = await updateOrderStatus(
    merchantCookie,
    expiredOrderId,
    "delivered",
    expiredOrderOtp
  );
  assert(expiredDelivered.res.status === 409, "Expired OTP should return 409.");
  assert(
    String(expiredDelivered.json?.error?.code || "") === "DELIVERY_OTP_EXPIRED",
    "Expired OTP should return DELIVERY_OTP_EXPIRED."
  );

  const override = await requestJson(
    `/api/admin/orders/delivery-override?key=${encodeURIComponent(adminKey)}`,
    {
      method: "POST",
      body: {
        orderId: expiredOrderId,
        confirm: "OVERRIDE",
        note: "Smoke override for expired OTP",
        resolvedBy: "Ops Smoke",
      },
    }
  );
  assert(override.res.ok, "Delivery override failed.");
  assert(String(override.json?.order?.status || "") === "delivered", "Override should deliver order.");
  assert(
    String(override.json?.order?.deliveryProof?.verifiedBy || "") === "admin_override",
    "Override should set verifiedBy=admin_override."
  );

  if (mongoose.connection.readyState === 1) {
    await mongoose.disconnect();
  }

  console.log("Smoke delivery OTP passed.");
  console.log(
    JSON.stringify(
      {
        businessId,
        orderId,
        expiredOrderId,
      },
      null,
      2
    )
  );
}

main().catch(async (error) => {
  if (mongoose.connection.readyState === 1) {
    await mongoose.disconnect().catch(() => null);
  }
  console.error("Smoke delivery OTP failed:", error instanceof Error ? error.message : String(error));
  process.exit(1);
});
