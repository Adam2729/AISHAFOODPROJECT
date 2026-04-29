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

async function resolveSmokeCity() {
  const [adminCities, publicCities] = await Promise.all([
    requestJson(`/api/admin/cities?key=${encodeURIComponent(adminKey)}`),
    requestJson("/api/public/cities"),
  ]);
  assert(adminCities.res.ok && adminCities.json?.ok, "Admin cities failed.");
  assert(publicCities.res.ok && publicCities.json?.ok, "Public cities failed.");

  const adminRows = Array.isArray(adminCities.json?.cities) ? adminCities.json.cities : [];
  const publicRows = Array.isArray(publicCities.json?.cities) ? publicCities.json.cities : [];
  const city =
    adminRows.find((row) => String(row?.code || "").toUpperCase() === "BKO") ||
    adminRows.find((row) => String(row?.name || "").toLowerCase() === "bamako");

  assert(city?._id, "Bamako city not found.");
  assert(
    publicRows.some((row) => String(row?.code || "").toUpperCase() === "BKO"),
    "Bamako is not active in public cities."
  );

  return {
    id: String(city._id),
    name: String(city.name || "Bamako"),
    centerLat: Number(city.coverageCenterLat || 12.6392),
    centerLng: Number(city.coverageCenterLng || -8.0029),
  };
}

async function ensureBusinessInCity(businessId, city) {
  if (mongoose.connection.readyState !== 1) {
    await mongoose.connect(mongoUri, { autoIndex: false });
  }
  const db = mongoose.connection.db;
  if (!db) throw new Error("Mongo connection unavailable.");

  await db.collection("businesses").updateOne(
    { _id: new mongoose.Types.ObjectId(businessId) },
    {
      $set: {
        cityId: new mongoose.Types.ObjectId(String(city.id)),
        deliveryType: "platform_driver",
        "deliveryPolicy.mode": "platform_driver",
        "deliveryPolicy.updatedAt": new Date(),
        location: {
          type: "Point",
          coordinates: [Number(city.centerLng), Number(city.centerLat)],
        },
      },
    }
  );
}

async function merchantLoginAndOpenHours(businessId, pin) {
  const loginRes = await requestJson("/api/merchant/auth/login", {
    method: "POST",
    body: { businessId, pin },
  });
  assert(loginRes.res.ok, `Merchant login failed: ${loginRes.text}`);
  let merchantCookie = parseCookieHeader(loginRes.res.headers.get("set-cookie"));
  assert(merchantCookie, "Merchant cookie missing.");

  if (Boolean(loginRes.json?.mustChangePin)) {
    const newPin = "5678";
    const setPin = await requestJson("/api/merchant/auth/set-pin", {
      method: "POST",
      cookie: merchantCookie,
      body: { newPin, confirmPin: newPin },
    });
    assert(setPin.res.ok, "set-pin failed.");

    const relogin = await requestJson("/api/merchant/auth/login", {
      method: "POST",
      body: { businessId, pin: newPin },
    });
    assert(relogin.res.ok, "Merchant re-login failed.");
    merchantCookie = parseCookieHeader(relogin.res.headers.get("set-cookie"));
    assert(merchantCookie, "Merchant cookie missing after re-login.");
  }

  const settings = await requestJson("/api/merchant/business/settings", {
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

async function createPlatformDriverOrderFixture(city) {
  const pin = "1234";
  const businessCreate = await requestJson(
    `/api/admin/businesses?key=${encodeURIComponent(adminKey)}`,
    {
      method: "POST",
      body: {
        type: "restaurant",
        name: randomLabel("DeliveryExceptionBiz"),
        phone: randomPhone("2237"),
        whatsapp: randomPhone("2237"),
        address: "Bamako Centre",
        lat: city.centerLat,
        lng: city.centerLng,
        pin,
      },
    }
  );
  assert(businessCreate.res.status === 201, `Business creation failed: ${businessCreate.text}`);
  const businessId = String(businessCreate.json?.business?._id || "");
  assert(businessId, "Missing businessId.");
  await ensureBusinessInCity(businessId, city);

  const merchantCookie = await merchantLoginAndOpenHours(businessId, pin);

  const productCreate = await requestJson("/api/merchant/products", {
    method: "POST",
    cookie: merchantCookie,
    body: {
      name: randomLabel("DeliveryExceptionProduct"),
      price: 3900,
      category: "Dispatch",
      isAvailable: true,
    },
  });
  assert(productCreate.res.status === 201, `Product creation failed: ${productCreate.text}`);
  const productId = String(productCreate.json?.product?._id || "");
  assert(productId, "Missing productId.");

  const orderCoords = coordsAtDistance(city.centerLat, city.centerLng, 1.35);
  const orderCreate = await requestJson("/api/public/orders", {
    method: "POST",
    headers: { "x-city-id": city.id },
    body: {
      customerName: "Smoke Delivery Exception Customer",
      phone: randomPhone("2237"),
      address: "Hamdallaye ACI, Bamako",
      lat: orderCoords.lat,
      lng: orderCoords.lng,
      city: city.name,
      cityId: city.id,
      businessId,
      items: [{ productId, qty: 1 }],
    },
  });
  assert(orderCreate.res.status === 201, `Order create failed: ${orderCreate.text}`);
  const orderNumber = String(orderCreate.json?.orderNumber || "");
  assert(orderNumber, "Missing orderNumber.");

  const merchantOrders = await requestJson("/api/merchant/orders", { cookie: merchantCookie });
  assert(merchantOrders.res.ok && merchantOrders.json?.ok, "Failed to list merchant orders.");
  const rows = Array.isArray(merchantOrders.json?.orders) ? merchantOrders.json.orders : [];
  const order = rows.find((row) => String(row?.orderNumber || "") === orderNumber);
  assert(order?._id, "Order not found in merchant list.");
  const orderId = String(order._id);

  for (const status of ["accepted", "preparing", "ready"]) {
    const patch = await requestJson(`/api/merchant/orders/${encodeURIComponent(orderId)}`, {
      method: "PATCH",
      cookie: merchantCookie,
      body: { status },
    });
    assert(patch.res.ok, `Failed transition to ${status}: ${patch.text}`);
  }

  return {
    businessId,
    orderId,
    orderNumber,
  };
}

async function createDriverAndToken(city) {
  const driverCreate = await requestJson(`/api/admin/drivers?key=${encodeURIComponent(adminKey)}`, {
    method: "POST",
    body: {
      name: randomLabel("DeliveryExceptionDriver"),
      phoneE164: `+${randomPhone("2237")}`,
      zoneLabel: "Bamako Exception Zone",
      isActive: true,
      cityId: city.id,
    },
  });
  assert(driverCreate.res.status === 201, `Driver creation failed: ${driverCreate.text}`);
  const driverId = String(driverCreate.json?.driver?.id || "");
  assert(driverId, "Missing driverId.");

  const linkRes = await requestJson(`/api/admin/drivers?key=${encodeURIComponent(adminKey)}`, {
    method: "PATCH",
    body: {
      action: "generate_link",
      driverId,
      cityId: city.id,
      confirm: "REVEAL LINK",
    },
  });
  assert(linkRes.res.ok, `Driver link generation failed: ${linkRes.text}`);
  const driverToken = String(linkRes.json?.token || "").trim();
  assert(driverToken, "Missing driver token.");

  return {
    driverId,
    driverToken,
  };
}

async function main() {
  console.log(`Running delivery exception smoke against ${baseUrl}`);

  const health = await requestJson("/api/health");
  assert(health.res.ok, "Health check failed.");

  await requestJson(`/api/admin/maintenance?key=${encodeURIComponent(adminKey)}`, {
    method: "POST",
    body: { enabled: false },
  });

  const city = await resolveSmokeCity();
  const fixture = await createPlatformDriverOrderFixture(city);
  const driver = await createDriverAndToken(city);

  const assign = await requestJson(`/api/admin/dispatch/assign?key=${encodeURIComponent(adminKey)}`, {
    method: "POST",
    body: {
      orderId: fixture.orderId,
      driverId: driver.driverId,
      confirm: "ASSIGN",
    },
  });
  assert(assign.res.ok, `Dispatch assign failed: ${assign.text}`);

  const exception = await requestJson(
    `/api/driver/orders/${encodeURIComponent(fixture.orderId)}/exception?token=${encodeURIComponent(
      driver.driverToken
    )}&cityId=${encodeURIComponent(city.id)}`,
    {
      method: "POST",
      body: {
        reason: "customer_unreachable",
        note: "Smoke delivery exception validation",
      },
    }
  );
  assert(exception.res.ok, `Driver exception failed: ${exception.text}`);
  assert(
    String(exception.json?.deliveryException?.status || "") === "open",
    "Delivery exception did not persist."
  );

  const events = await requestJson(
    `/api/admin/notification-events?key=${encodeURIComponent(adminKey)}&orderId=${encodeURIComponent(
      fixture.orderId
    )}&eventType=delivery_exception&limit=20`
  );
  assert(events.res.ok && events.json?.ok, `Notification events query failed: ${events.text}`);
  const rows = Array.isArray(events.json?.rows) ? events.json.rows : [];
  const merchantRows = rows.filter((row) => row?.audience === "merchant");
  const customerRows = rows.filter((row) => row?.audience === "customer");
  assert(merchantRows.length === 1, "Expected exactly one merchant delivery_exception event.");
  assert(customerRows.length === 1, "Expected exactly one customer delivery_exception event.");

  console.log("Smoke delivery exception passed.");
  console.log(
    JSON.stringify(
      {
        cityId: city.id,
        businessId: fixture.businessId,
        orderId: fixture.orderId,
        orderNumber: fixture.orderNumber,
        driverId: driver.driverId,
        merchantEventId: merchantRows[0]?.id || null,
        customerEventId: customerRows[0]?.id || null,
      },
      null,
      2
    )
  );
}

main()
  .catch((error) => {
    console.error(
      "Smoke delivery exception failed:",
      error instanceof Error ? error.message : String(error)
    );
    process.exit(1);
  })
  .finally(async () => {
    if (mongoose.connection.readyState === 1) {
      await mongoose.disconnect().catch(() => null);
    }
  });
