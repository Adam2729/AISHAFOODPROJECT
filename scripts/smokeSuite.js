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
    // Optional in case dotenv is not present in minimal installs.
    const dotenv = require("dotenv");
    dotenv.config({ path: localPath });
    dotenv.config({ path: envPath });
  } catch {
    // Env may already be injected by process manager.
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

async function main() {
  console.log(`Running smoke suite against ${baseUrl}`);

  const health = await requestJson("/api/health");
  assert(health.res.ok, "Health check failed.");

  const maintenanceOff = await requestJson(`/api/admin/maintenance?key=${encodeURIComponent(adminKey)}`, {
    method: "POST",
    body: { enabled: false },
  });
  assert(maintenanceOff.res.ok, "Failed to disable maintenance mode.");

  const pin = "1234";
  const businessName = randomLabel("SmokeBiz");
  const businessBody = {
    type: "restaurant",
    name: businessName,
    phone: "8095551001",
    whatsapp: "18095551001",
    address: "Naco, Santo Domingo",
    lat: 18.5209,
    lng: -69.9589,
    pin,
  };
  const createdBusiness = await requestJson(`/api/admin/businesses?key=${encodeURIComponent(adminKey)}`, {
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
    assert(relogin.ok, "Merchant re-login after PIN change failed.");
    merchantCookie = parseCookieHeader(relogin.headers.get("set-cookie"));
    assert(!!merchantCookie, "Merchant session cookie missing after PIN change.");
  }

  const productName = randomLabel("SmokeProduct");
  const createdProduct = await requestJson("/api/merchant/products", {
    method: "POST",
    cookie: merchantCookie,
    body: {
      name: productName,
      price: 250,
      category: "Sandwiches",
      isAvailable: true,
    },
  });
  assert(createdProduct.res.status === 201, "Product creation failed.");
  const productId = String(createdProduct.json?.product?._id || "");
  assert(!!productId, "Product ID missing.");

  const createdOrder = await requestJson("/api/public/orders", {
    method: "POST",
    body: {
      customerName: "Cliente Smoke",
      phone: "8095552002",
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

  const merchantOrders = await requestJson("/api/merchant/orders", {
    cookie: merchantCookie,
  });
  assert(merchantOrders.res.ok, "Failed to list merchant orders.");
  const orders = Array.isArray(merchantOrders.json?.orders) ? merchantOrders.json.orders : [];
  const targetOrder = orders.find((x) => String(x?.orderNumber || "") === orderNumber);
  const orderId = String(targetOrder?._id || "");
  assert(!!orderId, "Created order not found in merchant orders.");

  const transitions = ["accepted", "preparing", "ready", "delivered"];
  for (const status of transitions) {
    const patch = await requestJson(`/api/merchant/orders/${encodeURIComponent(orderId)}`, {
      method: "PATCH",
      cookie: merchantCookie,
      body: { status },
    });
    assert(patch.res.ok, `Failed status transition to ${status}.`);
  }

  const settlementsWeek = await requestJson(`/api/admin/settlements?key=${encodeURIComponent(adminKey)}`);
  assert(settlementsWeek.res.ok, "Failed to load settlements.");
  const weekKey = String(settlementsWeek.json?.weekKey || "");
  assert(!!weekKey, "weekKey missing from settlements response.");
  const settlementsRows = Array.isArray(settlementsWeek.json?.settlements)
    ? settlementsWeek.json.settlements
    : [];
  const settlement = settlementsRows.find((x) => String(x?.businessId || "") === businessId);
  assert(!!settlement, "Settlement row missing for business.");
  assert(Number(settlement?.ordersCount || 0) >= 1, "Settlement ordersCount not incremented.");
  assert(Number(settlement?.feeTotal || 0) > 0, "Settlement feeTotal not incremented.");

  const audit = await requestJson(
    `/api/admin/audit?key=${encodeURIComponent(adminKey)}&businessId=${encodeURIComponent(
      businessId
    )}&weekKey=${encodeURIComponent(weekKey)}&limit=50`
  );
  assert(audit.res.ok, "Failed to load audit.");
  const events = Array.isArray(audit.json?.events) ? audit.json.events : [];
  const countedEvent = events.find(
    (x) => String(x?.action || "") === "ORDER_COUNTED" && String(x?.orderId || "") === orderId
  );
  assert(!!countedEvent, "ORDER_COUNTED audit event missing.");

  console.log("Smoke suite passed.");
  console.log(
    JSON.stringify(
      {
        businessId,
        productId,
        orderId,
        orderNumber,
        weekKey,
      },
      null,
      2
    )
  );
}

main().catch((err) => {
  console.error("Smoke suite failed:", err instanceof Error ? err.message : String(err));
  process.exit(1);
});
