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

async function requestJson(pathname, options = {}) {
  const headers = {
    "Content-Type": "application/json",
    ...(options.headers || {}),
  };
  if (options.cookie) headers.Cookie = options.cookie;

  const res = await fetch(`${baseUrl}${pathname}`, {
    method: options.method || "GET",
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const text = await res.text();
  const json = text ? JSON.parse(text) : {};
  return { res, json, text };
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function createMerchantSession() {
  const pin = "1234";
  const businessName = randomLabel("CatalogOpsBiz");
  const createdBusiness = await requestJson(`/api/admin/businesses?key=${encodeURIComponent(adminKey)}`, {
    method: "POST",
    body: {
      type: "colmado",
      merchantType: "grocery",
      name: businessName,
      phone: "22370001011",
      whatsapp: "22370001011",
      address: "Hamdallaye, Bamako",
      lat: 12.6392,
      lng: -8.0029,
      pin,
    },
  });
  assert(createdBusiness.res.status === 201, `Business creation failed: ${createdBusiness.text}`);
  const businessId = String(createdBusiness.json?.business?._id || "");
  assert(businessId, "Business ID missing.");

  const loginRes = await fetch(`${baseUrl}/api/merchant/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ businessId, pin }),
  });
  const loginJson = await loginRes.json().catch(() => null);
  assert(loginRes.ok, "Merchant login failed.");
  let merchantCookie = parseCookieHeader(loginRes.headers.get("set-cookie"));
  assert(merchantCookie, "Merchant session cookie missing.");

  if (Boolean(loginJson?.mustChangePin)) {
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
    assert(merchantCookie, "Merchant session cookie missing after PIN change.");
  }

  return { businessId, merchantCookie };
}

async function publicMenu(businessId) {
  const menu = await requestJson(`/api/public/businesses/${businessId}/menu`);
  assert(menu.res.ok && menu.json?.ok, `Public menu failed: ${menu.text}`);
  return Array.isArray(menu.json.products) ? menu.json.products : [];
}

async function main() {
  console.log(`Running merchant catalog ops smoke against ${baseUrl}`);
  const { businessId, merchantCookie } = await createMerchantSession();

  const createdCategory = await requestJson("/api/merchant/categories", {
    method: "POST",
    cookie: merchantCookie,
    body: { name: "Boissons" },
  });
  assert(createdCategory.res.status === 201, `Category creation failed: ${createdCategory.text}`);
  const categoryId = String(createdCategory.json?.category?.id || "");
  assert(categoryId, "Category ID missing.");

  const renamedCategory = await requestJson(`/api/merchant/categories/${categoryId}`, {
    method: "PATCH",
    cookie: merchantCookie,
    body: { name: "Epicerie" },
  });
  assert(renamedCategory.res.ok, `Category rename failed: ${renamedCategory.text}`);

  const productName = randomLabel("Rice");
  const createdProduct = await requestJson("/api/merchant/products", {
    method: "POST",
    cookie: merchantCookie,
    body: {
      name: productName,
      price: 2500,
      category: "Epicerie",
      description: "Smoke test rice bag",
      quantityValue: 2,
      quantityUnit: "kg",
      isAvailable: true,
    },
  });
  assert(createdProduct.res.status === 201, `Product creation failed: ${createdProduct.text}`);
  const productId = String(createdProduct.json?.product?._id || "");
  assert(productId, "Product ID missing.");
  assert(createdProduct.json?.product?.displaySize === "2 kg", "Quantity/unit display label was not generated.");

  const editedProduct = await requestJson(`/api/merchant/products/${productId}`, {
    method: "PATCH",
    cookie: merchantCookie,
    body: {
      name: `${productName} Edited`,
      price: 2600,
      category: "Epicerie",
      description: "Edited smoke test rice bag",
      quantityValue: 500,
      quantityUnit: "g",
      displaySize: "",
      isAvailable: true,
    },
  });
  assert(editedProduct.res.ok, `Product edit failed: ${editedProduct.text}`);
  assert(editedProduct.json?.product?.displaySize === "500 g", "Edited quantity/unit did not persist.");

  let publicMenuRows = await publicMenu(businessId);
  let publicIds = new Set(publicMenuRows.map((row) => String(row.id || row._id || "")));
  assert(publicIds.has(productId), "Available product should appear in public menu.");
  const publicProduct = publicMenuRows.find((row) => String(row.id || row._id || "") === productId);
  assert(publicProduct?.displaySize === "500 g", "Public menu should expose the generated displaySize.");
  assert(publicProduct?.category === "Epicerie", "Public menu should expose the product category.");

  const unavailable = await requestJson(`/api/merchant/products/${productId}/availability`, {
    method: "PATCH",
    cookie: merchantCookie,
    body: { isAvailable: false, reason: "out_of_stock" },
  });
  assert(unavailable.res.ok, `Availability toggle failed: ${unavailable.text}`);
  publicMenuRows = await publicMenu(businessId);
  publicIds = new Set(publicMenuRows.map((row) => String(row.id || row._id || "")));
  assert(!publicIds.has(productId), "Unavailable product should not appear in public menu.");

  const available = await requestJson(`/api/merchant/products/${productId}/availability`, {
    method: "PATCH",
    cookie: merchantCookie,
    body: { isAvailable: true },
  });
  assert(available.res.ok, `Availability restore failed: ${available.text}`);

  const archived = await requestJson(`/api/merchant/products/${productId}`, {
    method: "DELETE",
    cookie: merchantCookie,
  });
  assert(archived.res.ok && archived.json?.archived, `Product archive failed: ${archived.text}`);
  publicMenuRows = await publicMenu(businessId);
  publicIds = new Set(publicMenuRows.map((row) => String(row.id || row._id || "")));
  assert(!publicIds.has(productId), "Archived product should not appear in public menu.");

  const archivedCategory = await requestJson(`/api/merchant/categories/${categoryId}`, {
    method: "DELETE",
    cookie: merchantCookie,
  });
  assert(archivedCategory.res.ok && archivedCategory.json?.archived, `Category archive failed: ${archivedCategory.text}`);

  console.log("Merchant catalog ops smoke passed.");
  console.log(JSON.stringify({ businessId, productId, categoryId }, null, 2));
}

main().catch((err) => {
  console.error("Merchant catalog ops smoke failed:", err instanceof Error ? err.message : String(err));
  process.exit(1);
});
