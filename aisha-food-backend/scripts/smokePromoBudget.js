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
    // Env may already be injected by runtime.
  }
}

loadEnvForScript();

const baseUrl = String(process.env.SMOKE_BASE_URL || "http://localhost:3000").replace(/\/+$/, "");
const adminKey = String(process.env.ADMIN_KEY || "").trim();

if (!adminKey) {
  console.error("Missing ADMIN_KEY env var.");
  process.exit(1);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function randomLabel(prefix) {
  const n = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `${prefix}-${Date.now()}-${n}`;
}

function randomPhone() {
  const suffix = Math.floor(Math.random() * 9000000 + 1000000);
  return `809${suffix}`;
}

function parseCookieHeader(setCookie) {
  if (!setCookie) return "";
  const first = setCookie.split(",")[0];
  return first.split(";")[0].trim();
}

async function request(pathname, options) {
  const method = options?.method || "GET";
  const headers = {
    "Content-Type": "application/json",
  };
  if (options?.cookie) headers.Cookie = options.cookie;
  if (options?.headers) Object.assign(headers, options.headers);

  const res = await fetch(`${baseUrl}${pathname}`, {
    method,
    headers,
    body: options?.body ? JSON.stringify(options.body) : undefined,
  });

  const text = await res.text();
  const json = text ? JSON.parse(text) : {};
  return { res, json };
}

async function setBoolSetting(key, value) {
  const result = await request(`/api/admin/settings/bool?key=${encodeURIComponent(adminKey)}`, {
    method: "POST",
    body: { key, value },
  });
  assert(result.res.ok, `Failed setting bool ${key}.`);
}

async function setNumberSetting(key, value) {
  const result = await request(`/api/admin/settings/number?key=${encodeURIComponent(adminKey)}`, {
    method: "POST",
    body: { key, value },
  });
  assert(result.res.ok, `Failed setting number ${key}.`);
}

async function getMetrics() {
  const result = await request(`/api/admin/metrics?key=${encodeURIComponent(adminKey)}`);
  assert(result.res.ok, "Failed to load metrics.");
  return result.json;
}

async function createMerchantAndProduct() {
  const pin = "1234";
  const businessName = randomLabel("BudgetBiz");
  const businessBody = {
    type: "restaurant",
    name: businessName,
    phone: randomPhone(),
    whatsapp: `1${randomPhone()}`,
    address: "Naco, Santo Domingo",
    lat: 18.5209,
    lng: -69.9589,
    pin,
  };
  const business = await request(`/api/admin/businesses?key=${encodeURIComponent(adminKey)}`, {
    method: "POST",
    body: businessBody,
  });
  assert(business.res.status === 201, "Business creation failed.");
  const businessId = String(business.json?.business?._id || "");
  assert(!!businessId, "Missing businessId.");

  const loginRes = await fetch(`${baseUrl}/api/merchant/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ businessId, pin }),
  });
  const loginJson = await loginRes.json();
  assert(loginRes.ok, "Merchant login failed.");
  let merchantCookie = parseCookieHeader(loginRes.headers.get("set-cookie"));
  assert(!!merchantCookie, "Merchant cookie missing.");

  if (Boolean(loginJson.mustChangePin)) {
    const newPin = "5678";
    const setPinRes = await request("/api/merchant/auth/set-pin", {
      method: "POST",
      cookie: merchantCookie,
      body: { newPin, confirmPin: newPin },
    });
    assert(setPinRes.res.ok, "PIN setup failed.");
    const relogin = await fetch(`${baseUrl}/api/merchant/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ businessId, pin: newPin }),
    });
    assert(relogin.ok, "Merchant re-login failed.");
    merchantCookie = parseCookieHeader(relogin.headers.get("set-cookie"));
    assert(!!merchantCookie, "Merchant cookie missing after re-login.");
  }

  const product = await request("/api/merchant/products", {
    method: "POST",
    cookie: merchantCookie,
    body: {
      name: randomLabel("BudgetProduct"),
      price: 180,
      category: "Sandwiches",
      isAvailable: true,
    },
  });
  assert(product.res.status === 201, "Product creation failed.");
  const productId = String(product.json?.product?._id || "");
  assert(!!productId, "Missing productId.");

  return { businessId, productId, merchantCookie };
}

async function createPromo() {
  const code = `BGT${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
  const promo = await request(`/api/admin/promos/create?key=${encodeURIComponent(adminKey)}`, {
    method: "POST",
    body: {
      code,
      type: "fixed",
      value: 20,
      minSubtotal: 0,
      perPhoneLimit: 10,
    },
  });
  assert(promo.res.status === 201, "Promo creation failed.");
  return code;
}

async function validatePromo({ businessId, subtotal, promoCode, phone }) {
  return request("/api/public/promo/validate", {
    method: "POST",
    body: {
      businessId,
      subtotal,
      promoCode,
      phone,
    },
  });
}

async function createOrder({ businessId, productId, phone, promoCode }) {
  return request("/api/public/orders", {
    method: "POST",
    body: {
      customerName: "Cliente Promo Budget",
      phone,
      address: "Piantini, Santo Domingo",
      lat: 18.5211,
      lng: -69.9591,
      businessId,
      items: [{ productId, qty: 1 }],
      promoCode,
    },
  });
}

async function deliverOrderByNumber({ merchantCookie, orderNumber }) {
  const list = await request("/api/merchant/orders", { cookie: merchantCookie });
  assert(list.res.ok, "Failed to list merchant orders.");
  const orders = Array.isArray(list.json?.orders) ? list.json.orders : [];
  const order = orders.find((row) => String(row?.orderNumber || "") === orderNumber);
  const orderId = String(order?._id || "");
  assert(!!orderId, "Order not found for delivery.");

  for (const status of ["accepted", "preparing", "ready", "delivered"]) {
    const patch = await request(`/api/merchant/orders/${encodeURIComponent(orderId)}`, {
      method: "PATCH",
      cookie: merchantCookie,
      body: { status },
    });
    assert(patch.res.ok, `Failed transition ${status}.`);
  }
}

function hasMessage(json, text) {
  const message = String(json?.message || "").toLowerCase();
  return message.includes(text.toLowerCase());
}

async function main() {
  console.log(`Running promo budget smoke against ${baseUrl}`);

  const health = await request("/api/health");
  assert(health.res.ok, "Health check failed.");

  await request(`/api/admin/maintenance?key=${encodeURIComponent(adminKey)}`, {
    method: "POST",
    body: { enabled: false },
  });

  const baselineMetrics = await getMetrics();
  const baselinePromosEnabled = Boolean(baselineMetrics?.kpis?.promosEnabled);
  const baselineBudget = Number(baselineMetrics?.kpis?.promoBudgetWeeklyRdp || 5000);

  await setBoolSetting("pilot_mode", false);

  const { businessId, productId, merchantCookie } = await createMerchantAndProduct();
  const promoCode = await createPromo();
  const subtotal = 180;

  try {
    process.stdout.write("- disabled behavior ... ");
    await setBoolSetting("promos_enabled", false);
    const disabledValidate = await validatePromo({
      businessId,
      subtotal,
      promoCode,
      phone: randomPhone(),
    });
    assert(disabledValidate.res.ok, "Validate should return 200 when promos disabled.");
    assert(disabledValidate.json?.valid === false, "Validate should be invalid when promos are disabled.");
    assert(hasMessage(disabledValidate.json, "deshabilitados"), "Disabled validate message mismatch.");

    const disabledCreate = await createOrder({
      businessId,
      productId,
      phone: randomPhone(),
      promoCode,
    });
    assert(disabledCreate.res.status === 409, "Create should return 409 when promos are disabled.");
    assert(
      String(disabledCreate.json?.error?.code || "") === "PROMOS_DISABLED",
      "Expected PROMOS_DISABLED error."
    );
    process.stdout.write("OK\n");

    process.stdout.write("- budget exceeded behavior ... ");
    await setBoolSetting("promos_enabled", true);
    await setNumberSetting("promo_budget_weekly_rdp", 0);
    const budgetValidate = await validatePromo({
      businessId,
      subtotal,
      promoCode,
      phone: randomPhone(),
    });
    assert(budgetValidate.res.ok, "Validate should return 200 on budget exceeded.");
    assert(budgetValidate.json?.valid === false, "Validate should be invalid when budget is exhausted.");
    assert(hasMessage(budgetValidate.json, "agotados"), "Budget validate message mismatch.");

    const budgetCreate = await createOrder({
      businessId,
      productId,
      phone: randomPhone(),
      promoCode,
    });
    assert(budgetCreate.res.status === 409, "Create should return 409 when budget is exhausted.");
    assert(
      String(budgetCreate.json?.error?.code || "") === "PROMO_BUDGET_EXCEEDED",
      "Expected PROMO_BUDGET_EXCEEDED error."
    );
    process.stdout.write("OK\n");

    process.stdout.write("- race behavior (validate ok -> create rejected) ... ");
    const liveMetrics = await getMetrics();
    const spent = Number(liveMetrics?.kpis?.promoDiscountSpentThisWeekRdp || 0);
    await setNumberSetting("promo_budget_weekly_rdp", spent + 20);

    const racePhoneA = randomPhone();
    const racePhoneB = randomPhone();
    const raceValidate = await validatePromo({
      businessId,
      subtotal,
      promoCode,
      phone: racePhoneA,
    });
    assert(raceValidate.res.ok, "Race validate request failed.");
    assert(raceValidate.json?.valid === true, "Race validate should pass before spend is consumed.");

    const consumingOrder = await createOrder({
      businessId,
      productId,
      phone: racePhoneB,
      promoCode,
    });
    assert(consumingOrder.res.status === 201, "Consuming order creation failed.");
    const consumingOrderNumber = String(consumingOrder.json?.orderNumber || "");
    assert(!!consumingOrderNumber, "Consuming order number missing.");
    await deliverOrderByNumber({ merchantCookie, orderNumber: consumingOrderNumber });

    const raceCreate = await createOrder({
      businessId,
      productId,
      phone: racePhoneA,
      promoCode,
    });
    assert(raceCreate.res.status === 409, "Race create should fail once budget is consumed.");
    assert(
      String(raceCreate.json?.error?.code || "") === "PROMO_BUDGET_EXCEEDED",
      "Race create should return PROMO_BUDGET_EXCEEDED."
    );
    process.stdout.write("OK\n");
  } finally {
    await setBoolSetting("promos_enabled", baselinePromosEnabled);
    await setNumberSetting("promo_budget_weekly_rdp", baselineBudget);
  }

  console.log("Promo budget smoke passed.");
}

main().catch((err) => {
  console.error("Promo budget smoke failed:", err instanceof Error ? err.message : String(err));
  process.exit(1);
});
