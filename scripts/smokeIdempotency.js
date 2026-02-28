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

function assert(condition, message) {
  if (!condition) throw new Error(message);
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

async function createSeedBusinessAndProduct() {
  const pin = "1234";
  const businessName = randomLabel("IdemBiz");
  const createdBusiness = await requestJson(`/api/admin/businesses?key=${encodeURIComponent(adminKey)}`, {
    method: "POST",
    body: {
      type: "restaurant",
      name: businessName,
      phone: "8095553301",
      whatsapp: "18095553301",
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
    assert(setPin.res.ok, "Initial PIN change failed.");
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
      name: randomLabel("IdemProduct"),
      price: 145,
      category: "Combos",
      isAvailable: true,
    },
  });
  assert(product.res.status === 201, "Product creation failed.");
  const productId = String(product.json?.product?._id || "");
  assert(!!productId, "Product ID missing.");

  return { businessId, productId, merchantCookie };
}

async function main() {
  console.log(`Running idempotency smoke against ${baseUrl}`);

  const health = await requestJson("/api/health");
  assert(health.res.ok, "Health check failed.");

  const seed = await createSeedBusinessAndProduct();
  const idempotencyKey = `idem-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const phone = `80955${String(Math.floor(Math.random() * 100000)).padStart(5, "0")}`;
  const orderPayload = {
    customerName: "Cliente Idempotency",
    phone,
    address: "Piantini, Santo Domingo",
    lat: 18.5211,
    lng: -69.9591,
    businessId: seed.businessId,
    items: [{ productId: seed.productId, qty: 1 }],
  };

  const first = await requestJson("/api/public/orders", {
    method: "POST",
    headers: { "Idempotency-Key": idempotencyKey },
    body: orderPayload,
  });
  assert(first.res.status === 201, "First order create should return 201.");

  const second = await requestJson("/api/public/orders", {
    method: "POST",
    headers: { "Idempotency-Key": idempotencyKey },
    body: orderPayload,
  });
  assert(second.res.status === 201, "Second order create should replay 201.");
  assert(
    String(second.json?.orderId || "") === String(first.json?.orderId || ""),
    "orderId mismatch for idempotent replay."
  );
  assert(
    String(second.json?.orderNumber || "") === String(first.json?.orderNumber || ""),
    "orderNumber mismatch for idempotent replay."
  );

  const merchantOrders = await requestJson("/api/merchant/orders", {
    cookie: seed.merchantCookie,
  });
  assert(merchantOrders.res.ok, "Merchant order list failed.");
  const rows = Array.isArray(merchantOrders.json?.orders) ? merchantOrders.json.orders : [];
  const matching = rows.filter(
    (row) =>
      String(row?.phone || "") === phone &&
      String(row?.orderNumber || "") === String(first.json?.orderNumber || "")
  );
  assert(matching.length === 1, "Expected exactly one persisted order for same idempotency key.");

  console.log("Idempotency smoke passed.");
  console.log(
    JSON.stringify(
      {
        businessId: seed.businessId,
        orderId: String(first.json?.orderId || ""),
        orderNumber: String(first.json?.orderNumber || ""),
        replayHeader: second.res.headers.get("x-idempotency-replayed") || null,
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(
    "Idempotency smoke failed:",
    error instanceof Error ? error.message : String(error)
  );
  process.exit(1);
});
