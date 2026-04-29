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

function randomLabel(prefix) {
  const n = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `${prefix}-${Date.now()}-${n}`;
}

function parseCookieHeader(setCookie) {
  if (!setCookie) return "";
  const first = setCookie.split(",")[0];
  return first.split(";")[0].trim();
}

async function requestJson(pathname, options) {
  const method = options?.method || "GET";
  const headers = {
    "Content-Type": "application/json",
    ...(options?.headers || {}),
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

async function createSeedOrder() {
  const pin = "1234";
  const businessName = randomLabel("PiiBiz");
  const createdBusiness = await requestJson(`/api/admin/businesses?key=${encodeURIComponent(adminKey)}`, {
    method: "POST",
    body: {
      type: "restaurant",
      name: businessName,
      phone: "8095551011",
      whatsapp: "18095551011",
      address: "Naco, Santo Domingo",
      lat: 18.5209,
      lng: -69.9589,
      pin,
    },
  });
  assert(createdBusiness.res.status === 201, "Business creation failed.");
  const businessId = String(createdBusiness.json?.business?._id || "");
  assert(!!businessId, "Business ID missing.");

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
    const setPin = await requestJson("/api/merchant/auth/set-pin", {
      method: "POST",
      cookie: merchantCookie,
      body: { newPin, confirmPin: newPin },
    });
    assert(setPin.res.ok, "PIN setup failed.");
    const relogin = await fetch(`${baseUrl}/api/merchant/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ businessId, pin: newPin }),
    });
    assert(relogin.ok, "Merchant re-login failed.");
    merchantCookie = parseCookieHeader(relogin.headers.get("set-cookie"));
    assert(!!merchantCookie, "Missing merchant cookie after re-login.");
  }

  const product = await requestJson("/api/merchant/products", {
    method: "POST",
    cookie: merchantCookie,
    body: {
      name: randomLabel("PiiProduct"),
      price: 190,
      category: "Sandwiches",
      isAvailable: true,
    },
  });
  assert(product.res.status === 201, "Product creation failed.");
  const productId = String(product.json?.product?._id || "");
  assert(!!productId, "Product ID missing.");

  const orderPhone = "8095553322";
  const createdOrder = await requestJson("/api/public/orders", {
    method: "POST",
    body: {
      customerName: "PII Smoke Customer",
      phone: orderPhone,
      sessionId: `smoke-${Date.now()}`,
      address: "Piantini, Santo Domingo",
      lat: 18.5211,
      lng: -69.9591,
      businessId,
      items: [{ productId, qty: 1 }],
    },
  });
  assert(createdOrder.res.status === 201, "Order creation failed.");
  const orderNumber = String(createdOrder.json?.orderNumber || "");
  assert(!!orderNumber, "Order number missing.");

  const merchantOrders = await requestJson("/api/merchant/orders", { cookie: merchantCookie });
  assert(merchantOrders.res.ok, "Merchant orders list failed.");
  const row = (merchantOrders.json?.orders || []).find((x) => String(x?.orderNumber || "") === orderNumber);
  assert(!!row, "Created order not visible in merchant orders.");
  assert(Boolean(String(row.phone || "").trim()), "Order phone should exist before redaction.");
  assert(Boolean(String(row.phoneHash || "").trim()), "Order phoneHash should exist.");

  return {
    merchantCookie,
    orderNumber,
    orderId: String(row._id || ""),
    phoneBefore: String(row.phone || ""),
    phoneHash: String(row.phoneHash || ""),
  };
}

async function main() {
  console.log(`Running pii redaction smoke against ${baseUrl}`);

  const health = await requestJson("/api/health");
  assert(health.res.ok, "Health check failed.");

  const seeded = await createSeedOrder();

  const run = await requestJson(
    `/api/admin/jobs/pii-redact?key=${encodeURIComponent(adminKey)}&retentionDays=0`,
    { method: "POST" }
  );
  assert(run.res.ok, "PII redaction job failed.");
  assert(Boolean(run.json?.ok), "PII redaction response not ok.");

  const afterOrders = await requestJson("/api/merchant/orders", { cookie: seeded.merchantCookie });
  assert(afterOrders.res.ok, "Merchant orders fetch after redaction failed.");
  const updated = (afterOrders.json?.orders || []).find(
    (x) => String(x?.orderNumber || "") === seeded.orderNumber
  );
  assert(!!updated, "Order not found after redaction.");

  const phoneAfter = updated.phone;
  assert(phoneAfter == null || String(phoneAfter).trim() === "", "Order phone should be redacted.");
  assert(
    String(updated.phoneHash || "") === seeded.phoneHash,
    "phoneHash must remain unchanged after redaction."
  );

  console.log("PII redaction smoke passed.");
  console.log(
    JSON.stringify(
      {
        orderId: seeded.orderId,
        orderNumber: seeded.orderNumber,
        phoneBefore: seeded.phoneBefore,
        phoneAfter: phoneAfter || null,
        phoneHash: seeded.phoneHash,
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error("PII redaction smoke failed:", error instanceof Error ? error.message : String(error));
  process.exit(1);
});

