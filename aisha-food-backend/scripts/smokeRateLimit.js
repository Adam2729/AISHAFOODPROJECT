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
  return { res, json, text };
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function createSeedBusinessAndProduct() {
  const pin = "1234";
  const businessName = randomLabel("RateBiz");
  const createdBusiness = await requestJson(`/api/admin/businesses?key=${encodeURIComponent(adminKey)}`, {
    method: "POST",
    body: {
      type: "restaurant",
      name: businessName,
      phone: "8095551101",
      whatsapp: "18095551101",
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
      name: randomLabel("RateProduct"),
      price: 130,
      category: "Snacks",
      isAvailable: true,
    },
  });
  assert(product.res.status === 201, "Product creation failed.");
  const productId = String(product.json?.product?._id || "");
  assert(!!productId, "Product ID missing.");

  return { businessId, productId };
}

async function main() {
  console.log(`Running rate-limit smoke against ${baseUrl}`);

  const health = await requestJson("/api/health");
  assert(health.res.ok, "Health check failed.");

  const seed = await createSeedBusinessAndProduct();
  const sessionId = `rate-smoke-${Date.now()}`;

  let blockedResponse = null;
  let blockedAttempt = -1;
  for (let attempt = 1; attempt <= 80; attempt += 1) {
    const response = await requestJson("/api/public/cart/upsell", {
      method: "POST",
      body: {
        businessId: seed.businessId,
        sessionId,
        items: [{ productId: seed.productId, qty: 1 }],
      },
    });
    if (response.res.status === 429) {
      blockedResponse = response;
      blockedAttempt = attempt;
      break;
    }
    assert(response.res.ok, `Unexpected non-200 before block at attempt ${attempt}.`);
  }

  assert(Boolean(blockedResponse), "Rate limit did not trigger within 80 attempts.");
  assert(blockedResponse.res.status === 429, "Expected HTTP 429 when limit is exceeded.");
  assert(
    String(blockedResponse.json?.error?.code || "") === "RATE_LIMIT",
    "Expected RATE_LIMIT error code."
  );
  const retryAfter = Number(blockedResponse.res.headers.get("retry-after") || 0);
  assert(retryAfter >= 1, "Retry-After header missing or invalid.");

  console.log("Rate-limit smoke passed.");
  console.log(
    JSON.stringify(
      {
        businessId: seed.businessId,
        blockedAttempt,
        retryAfter,
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error("Rate-limit smoke failed:", error instanceof Error ? error.message : String(error));
  process.exit(1);
});

