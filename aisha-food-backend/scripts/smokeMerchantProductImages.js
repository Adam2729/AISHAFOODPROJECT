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
const PRODUCT_IMAGE_MAX_BYTES = 5 * 1024 * 1024;

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

async function requestForm(pathname, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (options.cookie) headers.Cookie = options.cookie;
  const res = await fetch(`${baseUrl}${pathname}`, {
    method: options.method || "POST",
    headers,
    body: options.form,
  });
  const text = await res.text();
  const json = text ? JSON.parse(text) : {};
  return { res, json, text };
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function productForm(fields, file) {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    form.set(key, String(value));
  }
  if (file) form.set("imageFile", file.blob, file.name);
  return form;
}

async function createMerchantSession() {
  const pin = "1234";
  const businessName = randomLabel("ImageSmokeBiz");
  const createdBusiness = await requestJson(`/api/admin/businesses?key=${encodeURIComponent(adminKey)}`, {
    method: "POST",
    body: {
      type: "restaurant",
      name: businessName,
      phone: "22370001010",
      whatsapp: "22370001010",
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

async function main() {
  console.log(`Running merchant product image smoke against ${baseUrl}`);
  const { businessId, merchantCookie } = await createMerchantSession();

  const noImage = await requestJson("/api/merchant/products", {
    method: "POST",
    cookie: merchantCookie,
    body: {
      name: randomLabel("NoImageProduct"),
      price: 1500,
      category: "Plats",
      isAvailable: true,
    },
  });
  assert(noImage.res.status === 201, `No-image product creation failed: ${noImage.text}`);
  assert(String(noImage.json?.product?.imageUrl || "") === "", "No-image product should not get imageUrl.");

  const externalUrl = "https://example.com/menu/yassa.png";
  const withUrl = await requestJson("/api/merchant/products", {
    method: "POST",
    cookie: merchantCookie,
    body: {
      name: randomLabel("UrlImageProduct"),
      price: 1750,
      category: "Plats",
      imageUrl: externalUrl,
      isAvailable: true,
    },
  });
  assert(withUrl.res.status === 201, `URL-image product creation failed: ${withUrl.text}`);
  assert(String(withUrl.json?.product?.imageUrl || "") === externalUrl, "External image URL was not saved.");

  const pngBytes = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=",
    "base64"
  );
  const uploaded = await requestForm("/api/merchant/products", {
    method: "POST",
    cookie: merchantCookie,
    form: productForm(
      {
        name: randomLabel("UploadImageProduct"),
        price: 1900,
        category: "Plats",
        imageUrl: "https://example.com/should-lose.png",
        isAvailable: true,
      },
      { blob: new Blob([pngBytes], { type: "image/png" }), name: "tiny.png" }
    ),
  });

  const uploadUnavailable = uploaded.res.status === 503 && uploaded.json?.error?.code === "UPLOAD_UNAVAILABLE";
  if (uploadUnavailable) {
    console.log("Upload unavailable on this environment; URL-only product creation was verified.");
  } else {
    assert(uploaded.res.status === 201, `Uploaded-image product creation failed: ${uploaded.text}`);
    const uploadedUrl = String(uploaded.json?.product?.imageUrl || "");
    assert(uploadedUrl.startsWith("/uploads/products/"), "Uploaded image did not become canonical imageUrl.");

    const invalidFile = await requestForm("/api/merchant/products", {
      method: "POST",
      cookie: merchantCookie,
      form: productForm(
        {
          name: randomLabel("InvalidFileProduct"),
          price: 1000,
          category: "Tests",
          isAvailable: true,
        },
        { blob: new Blob(["not an image"], { type: "text/plain" }), name: "not-image.txt" }
      ),
    });
    assert(invalidFile.res.status === 400, "Invalid file type should be rejected.");

    const oversizedFile = await requestForm("/api/merchant/products", {
      method: "POST",
      cookie: merchantCookie,
      form: productForm(
        {
          name: randomLabel("OversizedFileProduct"),
          price: 1000,
          category: "Tests",
          isAvailable: true,
        },
        {
          blob: new Blob([new Uint8Array(PRODUCT_IMAGE_MAX_BYTES + 1)], { type: "image/png" }),
          name: "too-large.png",
        }
      ),
    });
    assert(oversizedFile.res.status === 413, "Oversized file should be rejected.");
  }

  console.log("Merchant product image smoke passed.");
  console.log(JSON.stringify({ businessId }, null, 2));
}

main().catch((err) => {
  console.error("Merchant product image smoke failed:", err instanceof Error ? err.message : String(err));
  process.exit(1);
});
