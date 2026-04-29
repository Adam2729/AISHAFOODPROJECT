/* eslint-disable @typescript-eslint/no-require-imports */
const path = require("node:path");
const crypto = require("node:crypto");
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
const linkSecret = String(process.env.DRIVER_LINK_SECRET || process.env.JWT_SECRET || "").trim();

if (!adminKey) {
  console.error("Missing ADMIN_KEY env var.");
  process.exit(1);
}
if (!mongoUri) {
  console.error("Missing MONGODB_URI env var.");
  process.exit(1);
}
if (!linkSecret) {
  console.error("Missing DRIVER_LINK_SECRET or JWT_SECRET env var.");
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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createDriverLinkToken(driverId, cityId, days = 7) {
  const payload = {
    driverId: String(driverId || "").trim(),
    cityId: String(cityId || "").trim(),
    exp: Math.floor(Date.now() / 1000) + Math.max(1, days) * 24 * 60 * 60,
  };
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = crypto.createHmac("sha256", linkSecret).update(encodedPayload).digest("base64url");
  return `${encodedPayload}.${signature}`;
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

async function transitionOrderToReady(cookie, orderId) {
  for (const status of ["accepted", "preparing", "ready"]) {
    const patch = await request(`/api/merchant/orders/${encodeURIComponent(orderId)}`, {
      method: "PATCH",
      cookie,
      body: { status },
    });
    assert(patch.res.ok, `Failed transition to ${status}: ${patch.text}`);
  }
}

async function listDrivers(cityId) {
  const params = new URLSearchParams({ key: adminKey, cityId, limit: "200" });
  const drivers = await request(`/api/ops/dispatch/drivers?${params.toString()}`);
  assert(drivers.res.ok && drivers.json?.ok, `Drivers endpoint failed: ${drivers.text}`);
  return Array.isArray(drivers.json?.rows) ? drivers.json.rows : [];
}

async function listAutoAssignQueue(cityId) {
  const params = new URLSearchParams({ key: adminKey, cityId, limit: "20" });
  const queue = await request(`/api/ops/dispatch/auto-assign-queue?${params.toString()}`);
  assert(queue.res.ok && queue.json?.ok, `Auto-assign queue failed: ${queue.text}`);
  return Array.isArray(queue.json?.rows) ? queue.json.rows : [];
}

async function listUnassigned(cityId) {
  const params = new URLSearchParams({ key: adminKey, cityId, status: "all", limit: "200" });
  const orders = await request(`/api/ops/dispatch/unassigned?${params.toString()}`);
  assert(orders.res.ok && orders.json?.ok, `Unassigned endpoint failed: ${orders.text}`);
  return Array.isArray(orders.json?.rows) ? orders.json.rows : [];
}

async function waitForDispatchableWork(cityId, options = {}) {
  const maxAttempts = Number(options.maxAttempts || 8);
  const delayMs = Number(options.delayMs || 750);

  let queue = [];
  let unassigned = [];

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    [queue, unassigned] = await Promise.all([
      listAutoAssignQueue(cityId),
      listUnassigned(cityId),
    ]);

    if (queue.length || unassigned.length) {
      return { queue, unassigned };
    }

    if (attempt < maxAttempts - 1) {
      await sleep(delayMs);
    }
  }

  return { queue, unassigned };
}

async function createDriverFixture(cityId, zoneLabel) {
  const driverCreate = await request(`/api/admin/drivers?key=${encodeURIComponent(adminKey)}`, {
    method: "POST",
    body: {
      name: randomLabel("P5-SMART-DRIVER"),
      phoneE164: `+${randomPhone("2237")}`,
      zoneLabel,
      isActive: true,
      cityId,
    },
  });
  assert(driverCreate.res.status === 201, `Driver creation failed: ${driverCreate.text}`);
  return String(driverCreate.json?.driver?.id || "");
}

async function createDispatchableOrderFixture(city, zoneLabel) {
  const pin = "1234";
  const businessCreate = await request(`/api/admin/businesses?key=${encodeURIComponent(adminKey)}`, {
    method: "POST",
    body: {
      type: "restaurant",
      name: randomLabel("P5-SMART-BIZ"),
      phone: randomPhone("2237"),
      whatsapp: randomPhone("2237"),
      address: "Bamako Centre",
      lat: Number(city.coverageCenterLat || 12.6392),
      lng: Number(city.coverageCenterLng || -8.0029),
      pin,
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
        cityId: new mongoose.Types.ObjectId(String(city._id)),
        deliveryType: "platform_driver",
        "deliveryPolicy.mode": "platform_driver",
        "deliveryPolicy.updatedAt": new Date(),
        zoneLabel: zoneLabel || null,
        location: {
          type: "Point",
          coordinates: [Number(city.coverageCenterLng || -8.0029), Number(city.coverageCenterLat || 12.6392)],
        },
      },
    }
  );

  const merchantCookie = await merchantLoginAndOpenHours(businessId, pin);

  const productCreate = await request("/api/merchant/products", {
    method: "POST",
    cookie: merchantCookie,
    body: {
      name: randomLabel("P5-SMART-PROD"),
      price: 5000,
      category: "Dispatch",
      isAvailable: true,
    },
  });
  assert(productCreate.res.status === 201, `Product creation failed: ${productCreate.text}`);
  const productId = String(productCreate.json?.product?._id || "");
  assert(productId, "Missing productId.");

  const orderCoords = coordsAtDistance(city.coverageCenterLat || 12.6392, city.coverageCenterLng || -8.0029, 3.01);
  const orderCreate = await request("/api/public/orders", {
    method: "POST",
    headers: { "x-city-id": String(city._id) },
    body: {
      customerName: "Phase5 Smart Dispatch Customer",
      phone: randomPhone("2237"),
      address: "Quartier Test, Bamako",
      lat: orderCoords.lat,
      lng: orderCoords.lng,
      city: "Bamako",
      cityId: String(city._id),
      businessId,
      items: [{ productId, qty: 1 }],
    },
  });
  assert(orderCreate.res.status === 201, `Order creation failed: ${orderCreate.text}`);
  const orderId = String(orderCreate.json?.orderId || "");
  assert(orderId, "Missing orderId.");

  await transitionOrderToReady(merchantCookie, orderId);
  return orderId;
}

async function main() {
  console.log(`Running Phase-5 smart dispatch smoke against ${baseUrl}`);

  const health = await request("/api/health");
  assert(health.res.ok, "Health check failed.");

  await request(`/api/admin/maintenance?key=${encodeURIComponent(adminKey)}`, {
    method: "POST",
    body: { enabled: false },
  });
  const seeded = await request(`/api/admin/jobs/seed-cities?key=${encodeURIComponent(adminKey)}`, {
    method: "POST",
  });
  assert(seeded.res.ok, `Seed cities failed: ${seeded.text}`);

  const [adminCities, publicCities] = await Promise.all([
    request(`/api/admin/cities?key=${encodeURIComponent(adminKey)}`),
    request("/api/public/cities"),
  ]);
  assert(adminCities.res.ok && adminCities.json?.ok, `Admin cities failed: ${adminCities.text}`);
  assert(publicCities.res.ok && publicCities.json?.ok, `Public cities failed: ${publicCities.text}`);

  const adminRows = Array.isArray(adminCities.json?.cities) ? adminCities.json.cities : [];
  const publicRows = Array.isArray(publicCities.json?.cities) ? publicCities.json.cities : [];
  const bamako =
    adminRows.find((row) => String(row?.code || "").toUpperCase() === "BKO") ||
    adminRows.find((row) => String(row?.name || "").toLowerCase() === "bamako");
  assert(bamako?._id, "Bamako city not found in admin cities.");
  assert(
    publicRows.some((row) => String(row?.code || "").toUpperCase() === "BKO"),
    "Bamako is not publicly active. Enable Bamako mode before running this smoke."
  );

  await mongoose.connect(mongoUri);

  const cityId = String(bamako._id);
  const preferredZone = "Bamako Dispatch Zone";

  let drivers = await listDrivers(cityId);
  while (drivers.length < 2) {
    const createdId = await createDriverFixture(cityId, preferredZone);
    assert(createdId, "Driver fixture creation failed.");
    drivers = await listDrivers(cityId);
  }

  const driverDocs = await mongoose.connection.db
    .collection("drivers")
    .find({ cityId: new mongoose.Types.ObjectId(cityId), isActive: true, isBanned: { $ne: true } })
    .sort({ createdAt: 1 })
    .limit(2)
    .toArray();
  assert(driverDocs.length >= 2, "Expected at least two active Bamako drivers.");

  const primaryDriverId = String(driverDocs[0]._id);
  const secondaryDriverId = String(driverDocs[1]._id);

  await mongoose.connection.db.collection("drivers").updateOne(
    { _id: new mongoose.Types.ObjectId(primaryDriverId) },
    {
      $set: {
        availability: "available",
        zoneLabel: preferredZone,
        isActive: true,
        isBanned: false,
        lastAssignedAt: new Date(Date.now() - 60 * 60 * 1000),
      },
    }
  );
  await mongoose.connection.db.collection("drivers").updateOne(
    { _id: new mongoose.Types.ObjectId(secondaryDriverId) },
    {
      $set: {
        availability: "busy",
        zoneLabel: "Other Zone",
        isActive: true,
        isBanned: false,
      },
    }
  );

  let { queue, unassigned } = await waitForDispatchableWork(cityId, {
    maxAttempts: 3,
    delayMs: 500,
  });
  if (!queue.length && !unassigned.length) {
    await createDispatchableOrderFixture(bamako, preferredZone);
    ({ queue, unassigned } = await waitForDispatchableWork(cityId));
  }
  assert(
    queue.length >= 1,
    "Expected at least one dispatchable order in the auto-assign queue after fixture setup."
  );
  const queueRow = queue[0];
  assert(String(queueRow?.suggestedDriverId || "").trim(), "Queue must include suggestedDriverId.");

  const orderId = String(queueRow.orderId || "");
  assert(orderId, "Missing queue orderId.");

  const autoAssign = await request(`/api/ops/dispatch/auto-assign?key=${encodeURIComponent(adminKey)}`, {
    method: "POST",
    body: {
      cityId,
      orderId,
      note: "phase5 smart dispatch smoke",
    },
  });
  assert(autoAssign.res.ok && autoAssign.json?.ok, `Auto-assign failed: ${autoAssign.text}`);
  assert(autoAssign.json?.assigned === true, "Auto-assign should return assigned=true.");
  assert(String(autoAssign.json?.driverId || "").trim(), "Auto-assign driverId missing.");
  assert(typeof autoAssign.json?.score === "number", "Auto-assign score must be numeric.");

  const driverId = String(autoAssign.json?.driverId || "");

  const history = await request(
    `/api/ops/dispatch/history?${new URLSearchParams({
      key: adminKey,
      cityId,
      orderId,
      limit: "10",
    }).toString()}`
  );
  assert(history.res.ok && history.json?.ok, `History failed: ${history.text}`);
  const historyRows = Array.isArray(history.json?.rows) ? history.json.rows : [];
  assert(
    historyRows.some((row) =>
      ["AUTO_DRIVER_ASSIGNED", "AUTO_ASSIGN_SKIPPED"].includes(String(row?.action || ""))
    ),
    "History must include AUTO_DRIVER_ASSIGNED or AUTO_ASSIGN_SKIPPED."
  );

  const availabilityToken = createDriverLinkToken(secondaryDriverId, cityId);
  const availability = await request(
    `/api/driver/availability?cityId=${encodeURIComponent(cityId)}&token=${encodeURIComponent(availabilityToken)}`,
    {
      method: "POST",
      body: { availability: "available" },
    }
  );
  assert(availability.res.ok && availability.json?.ok, `Availability update failed: ${availability.text}`);
  assert(availability.json?.availability === "available", "Availability toggle did not persist.");

  console.log(
    JSON.stringify(
      {
        ok: true,
        cityId,
        orderId,
        driverId,
        score: Number(autoAssign.json?.score || 0),
        etaMinutes: Number(autoAssign.json?.etaMinutes || 0),
      },
      null,
      2
    )
  );
}

main()
  .catch((error) => {
    console.error(
      "Smoke phase5-dispatch failed:",
      error instanceof Error ? error.message : String(error)
    );
    process.exit(1);
  })
  .finally(async () => {
    try {
      await mongoose.disconnect();
    } catch {
      // no-op
    }
  });
