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

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function randomLabel(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
}

function randomPhone(prefix = "2237") {
  const tail = Math.floor(Math.random() * 1000000)
    .toString()
    .padStart(6, "0");
  return `${prefix}${tail}`;
}

function parseCookieHeader(setCookie) {
  if (!setCookie) return "";
  const first = String(setCookie).split(",")[0];
  return first.split(";")[0].trim();
}

function parseTokenFromLink(linkUrl) {
  try {
    const url = new URL(String(linkUrl || ""));
    return String(url.searchParams.get("token") || "");
  } catch {
    return "";
  }
}

function kmToLatOffset(km) {
  const earthRadiusKm = 6371;
  return (Number(km) * 180) / (Math.PI * earthRadiusKm);
}

function coordsAtDistance(baseLat, baseLng, km) {
  return {
    lat: Number((Number(baseLat) + kmToLatOffset(km)).toFixed(6)),
    lng: Number(baseLng),
  };
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

async function request(pathname, options = {}) {
  const method = options.method || "GET";
  const headers = {};
  if (options.body !== undefined) headers["Content-Type"] = "application/json";
  if (options.cookie) headers.Cookie = options.cookie;
  if (options.headers && typeof options.headers === "object") {
    Object.assign(headers, options.headers);
  }

  const res = await fetch(`${baseUrl}${pathname}`, {
    method,
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { res, text, json };
}

async function merchantLoginAndOpenHours(businessId, pin) {
  const loginRes = await request("/api/merchant/auth/login", {
    method: "POST",
    body: { businessId, pin },
  });
  assert(loginRes.res.ok, `Merchant login failed: ${loginRes.text}`);
  let merchantCookie = parseCookieHeader(loginRes.res.headers.get("set-cookie"));
  assert(merchantCookie, "Merchant cookie missing.");

  if (Boolean(loginRes.json?.mustChangePin)) {
    const newPin = "5678";
    const setPin = await request("/api/merchant/auth/set-pin", {
      method: "POST",
      cookie: merchantCookie,
      body: { newPin, confirmPin: newPin },
    });
    assert(setPin.res.ok, `set-pin failed: ${setPin.text}`);

    const relogin = await request("/api/merchant/auth/login", {
      method: "POST",
      body: { businessId, pin: newPin },
    });
    assert(relogin.res.ok, `Merchant re-login failed: ${relogin.text}`);
    merchantCookie = parseCookieHeader(relogin.res.headers.get("set-cookie"));
    assert(merchantCookie, "Merchant cookie missing after re-login.");
  }

  const settings = await request("/api/merchant/business/settings", {
    method: "PATCH",
    cookie: merchantCookie,
    body: {
      isManuallyPaused: false,
      hours: {
        timezone: "Africa/Bamako",
        weekly: allDayWeekly(),
      },
    },
  });
  assert(settings.res.ok, `Failed to set merchant hours: ${settings.text}`);
  return merchantCookie;
}

async function createAssignedPipelineOrder({ cityId, cityLat, cityLng }) {
  await request(`/api/admin/maintenance?key=${encodeURIComponent(adminKey)}`, {
    method: "POST",
    body: { enabled: false },
  });

  const businessCreate = await request(`/api/admin/businesses?key=${encodeURIComponent(adminKey)}`, {
    method: "POST",
    body: {
      type: "restaurant",
      name: randomLabel("P3-DRIVERWEB-BIZ"),
      phone: randomPhone("2237"),
      whatsapp: randomPhone("2237"),
      address: "Bamako Centre",
      lat: cityLat,
      lng: cityLng,
      pin: "1234",
      isDemo: true,
    },
  });
  assert(businessCreate.res.status === 201, `Business creation failed: ${businessCreate.text}`);
  const businessId = String(businessCreate.json?.business?._id || "");
  assert(businessId, "Missing businessId.");

  await mongoose.connection.db.collection("businesses").updateOne(
    { _id: new mongoose.Types.ObjectId(businessId) },
    {
      $set: {
        cityId: new mongoose.Types.ObjectId(String(cityId)),
        location: {
          type: "Point",
          coordinates: [cityLng, cityLat],
        },
      },
    }
  );

  const merchantCookie = await merchantLoginAndOpenHours(businessId, "1234");

  const productCreate = await request("/api/merchant/products", {
    method: "POST",
    cookie: merchantCookie,
    body: {
      name: randomLabel("P3-DRIVERWEB-PROD"),
      price: 5000,
      category: "Pruebas",
      isAvailable: true,
    },
  });
  assert(productCreate.res.status === 201, `Product creation failed: ${productCreate.text}`);
  const productId = String(productCreate.json?.product?._id || "");
  assert(productId, "Missing productId.");

  const driverCreate = await request(`/api/admin/drivers?key=${encodeURIComponent(adminKey)}`, {
    method: "POST",
    body: {
      name: randomLabel("P3-DRIVERWEB-DRIVER"),
      phoneE164: randomPhone("2237"),
      zoneLabel: "Bamako",
      isActive: true,
    },
  });
  assert(driverCreate.res.status === 201, `Driver creation failed: ${driverCreate.text}`);
  const driverId = String(driverCreate.json?.driver?.id || "");
  assert(driverId, "Missing driverId.");

  const orderCoords = coordsAtDistance(cityLat, cityLng, 3.01);
  const orderCreate = await request("/api/public/orders", {
    method: "POST",
    headers: { "x-city": cityId },
    body: {
      customerName: "Phase3 Driver Web Customer",
      phone: randomPhone("2237"),
      address: "Quartier Test, Bamako",
      lat: orderCoords.lat,
      lng: orderCoords.lng,
      city: "Bamako",
      cityId,
      businessId,
      items: [{ productId, qty: 1 }],
    },
  });
  assert(orderCreate.res.status === 201, `Order creation failed: ${orderCreate.text}`);
  const orderId = String(orderCreate.json?.orderId || "");
  assert(orderId, "Missing orderId.");

  const assign = await request(`/api/admin/dispatch/assign?key=${encodeURIComponent(adminKey)}`, {
    method: "POST",
    body: { orderId, driverId, confirm: "ASSIGN" },
  });
  assert(assign.res.ok, `Dispatch assign failed: ${assign.text}`);

  const accepted = await request(`/api/merchant/orders/${encodeURIComponent(orderId)}`, {
    method: "PATCH",
    cookie: merchantCookie,
    body: { status: "accepted" },
  });
  assert(accepted.res.ok, `Order accept failed: ${accepted.text}`);

  return { driverId, orderId };
}

async function main() {
  console.log(`Running Phase-3 driver web smoke against ${baseUrl}`);

  const health = await request("/api/health");
  assert(health.res.ok, "Health check failed.");

  await request(`/api/admin/jobs/seed-cities?key=${encodeURIComponent(adminKey)}`, {
    method: "POST",
  });

  const [adminCities, publicCities] = await Promise.all([
    request(`/api/admin/cities?key=${encodeURIComponent(adminKey)}`),
    request("/api/public/cities"),
  ]);
  assert(adminCities.res.ok && adminCities.json?.ok, "Could not load admin cities.");
  assert(publicCities.res.ok && publicCities.json?.ok, "Could not load public cities.");

  const adminRows = Array.isArray(adminCities.json?.cities) ? adminCities.json.cities : [];
  const publicRows = Array.isArray(publicCities.json?.cities) ? publicCities.json.cities : [];
  const bamakoAdmin = adminRows.find((row) => String(row?.code || "").toUpperCase() === "BKO");
  assert(bamakoAdmin?._id, "Bamako city missing in admin cities.");
  const bamakoPublic = publicRows.some((row) => String(row?.code || "").toUpperCase() === "BKO");
  assert(bamakoPublic, "Bamako must be publicly active for this smoke.");

  const cityId = String(bamakoAdmin._id);
  const cityLat = Number(bamakoAdmin.coverageCenterLat || 12.6392);
  const cityLng = Number(bamakoAdmin.coverageCenterLng || -8.0029);

  await mongoose.connect(mongoUri);

  const created = await createAssignedPipelineOrder({ cityId, cityLat, cityLng });

  const sessionLink = await request(
    `/api/ops/drivers/${encodeURIComponent(created.driverId)}/session-link?key=${encodeURIComponent(
      adminKey
    )}&cityId=${encodeURIComponent(cityId)}`,
    {
      method: "POST",
    }
  );
  assert(sessionLink.res.ok && sessionLink.json?.ok, `Session-link failed: ${sessionLink.text}`);
  const linkUrl = String(sessionLink.json?.linkUrl || "");
  const token = parseTokenFromLink(linkUrl);
  assert(token, "Could not parse raw token from generated link.");

  const exchange = await request(`/api/driver/session/exchange?cityId=${encodeURIComponent(cityId)}`, {
    method: "POST",
    body: { token },
  });
  assert(exchange.res.ok && exchange.json?.ok, `Exchange failed: ${exchange.text}`);
  const driverCookie = parseCookieHeader(exchange.res.headers.get("set-cookie"));
  assert(driverCookie, "Driver session cookie missing after exchange.");

  const driverOrders = await request(`/api/driver/orders?cityId=${encodeURIComponent(cityId)}`, {
    cookie: driverCookie,
  });
  assert(driverOrders.res.ok && driverOrders.json?.ok, `Driver orders failed: ${driverOrders.text}`);
  const rows = Array.isArray(driverOrders.json?.orders) ? driverOrders.json.orders : [];
  assert(rows.length >= 1, "Driver orders should return at least one row.");
  const targetOrder = rows.find((row) => String(row?.orderId || "") === created.orderId) || rows[0];
  assert(targetOrder?.orderId, "No order available for status update.");

  const statusUpdate = await request(
    `/api/driver/orders/${encodeURIComponent(
      String(targetOrder.orderId)
    )}/status?cityId=${encodeURIComponent(cityId)}`,
    {
      method: "POST",
      cookie: driverCookie,
      body: { action: "picked_up" },
    }
  );
  assert(statusUpdate.res.ok && statusUpdate.json?.ok, `Status update failed: ${statusUpdate.text}`);
  const statusAfterPickedUp = String(statusUpdate.json?.status || "");

  const deliveredAttempt = await request(
    `/api/driver/orders/${encodeURIComponent(
      String(targetOrder.orderId)
    )}/status?cityId=${encodeURIComponent(cityId)}`,
    {
      method: "POST",
      cookie: driverCookie,
      body: { action: "delivered_attempt" },
    }
  );
  assert(
    deliveredAttempt.res.ok && deliveredAttempt.json?.ok,
    `Delivered-attempt failed: ${deliveredAttempt.text}`
  );
  const statusAfterDeliveredAttempt = String(deliveredAttempt.json?.status || "");
  assert(
    statusAfterDeliveredAttempt === statusAfterPickedUp,
    `Delivered attempt should not change status (got ${statusAfterDeliveredAttempt}).`
  );

  const driverAudit = await request(`/api/driver/audit?cityId=${encodeURIComponent(cityId)}`, {
    method: "POST",
    cookie: driverCookie,
    body: {
      action: "PROBLEM",
      note: "Cliente no responde al telefono",
      orderId: String(targetOrder.orderId),
    },
  });
  assert(driverAudit.res.ok && driverAudit.json?.ok, `Driver audit failed: ${driverAudit.text}`);

  const driverPage = await request(`/driver?cityId=${encodeURIComponent(cityId)}`);
  assert(driverPage.res.ok, "Driver page should render.");
  assert(
    String(driverPage.res.headers.get("content-type") || "").includes("text/html"),
    "Driver page must return HTML."
  );

  const linkPage = await request(
    `/driver/link?cityId=${encodeURIComponent(cityId)}&token=${encodeURIComponent(token)}`
  );
  assert(linkPage.res.ok, "Driver link page should render.");

  console.log(
    JSON.stringify(
      {
        cityId,
        driverId: created.driverId,
        orderId: String(targetOrder.orderId),
        exchangeOk: true,
        ordersCount: rows.length,
        statusAfterPickedUp,
        deliveredAttemptChanged: Boolean(deliveredAttempt.json?.changed),
        statusAfterDeliveredAttempt,
        auditId: String(driverAudit.json?.auditId || ""),
      },
      null,
      2
    )
  );
  console.log("Smoke phase3-driverweb passed.");
}

main()
  .catch((error) => {
    console.error("Smoke phase3-driverweb failed:", error instanceof Error ? error.message : String(error));
    process.exit(1);
  })
  .finally(async () => {
    try {
      await mongoose.disconnect();
    } catch {
      // no-op
    }
  });
