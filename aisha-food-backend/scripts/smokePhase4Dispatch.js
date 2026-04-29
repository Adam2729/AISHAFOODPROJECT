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

async function listBamakoDrivers(cityId) {
  const params = new URLSearchParams({
    key: adminKey,
    cityId,
    limit: "200",
  });
  const drivers = await request(`/api/ops/dispatch/drivers?${params.toString()}`);
  assert(drivers.res.ok && drivers.json?.ok, `Drivers endpoint failed: ${drivers.text}`);
  return Array.isArray(drivers.json?.rows) ? drivers.json.rows : [];
}

async function listUnassigned(cityId) {
  const params = new URLSearchParams({
    key: adminKey,
    cityId,
    status: "all",
    limit: "200",
  });
  const orders = await request(`/api/ops/dispatch/unassigned?${params.toString()}`);
  assert(orders.res.ok && orders.json?.ok, `Unassigned endpoint failed: ${orders.text}`);
  return Array.isArray(orders.json?.rows) ? orders.json.rows : [];
}

async function createDriverFixture(cityId, zoneLabel = "Bamako Dispatch") {
  const driverCreate = await request(`/api/admin/drivers?key=${encodeURIComponent(adminKey)}`, {
    method: "POST",
    body: {
      name: randomLabel("P4-DISPATCH-DRIVER"),
      phoneE164: `+${randomPhone("2237")}`,
      zoneLabel,
      isActive: true,
      cityId,
    },
  });
  assert(driverCreate.res.status === 201, `Driver creation failed: ${driverCreate.text}`);
  const driverId = String(driverCreate.json?.driver?.id || "");
  assert(driverId, "Missing driverId from create driver.");
  return driverId;
}

async function createDispatchableOrderFixture(city) {
  const pin = "1234";
  const businessCreate = await request(`/api/admin/businesses?key=${encodeURIComponent(adminKey)}`, {
    method: "POST",
    body: {
      type: "restaurant",
      name: randomLabel("P4-DISPATCH-BIZ"),
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

  const cityObjectId = new mongoose.Types.ObjectId(String(city._id));
  await mongoose.connection.db.collection("businesses").updateOne(
    { _id: new mongoose.Types.ObjectId(businessId) },
    {
      $set: {
        cityId: cityObjectId,
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
      name: randomLabel("P4-DISPATCH-PROD"),
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
    headers: {
      "x-city-id": String(city._id),
    },
    body: {
      customerName: "Phase4 Dispatch Customer",
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
  console.log(`Running Phase-4 dispatch smoke against ${baseUrl}`);

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
  const bamakoPublic = publicRows.some((row) => String(row?.code || "").toUpperCase() === "BKO");
  assert(
    bamakoPublic,
    "Bamako is not publicly active. Enable Bamako mode before running this smoke."
  );

  await mongoose.connect(mongoUri);

  const cityId = String(bamako._id);

  let drivers = await listBamakoDrivers(cityId);
  if (drivers.length < 1) {
    await createDriverFixture(cityId);
    drivers = await listBamakoDrivers(cityId);
  }
  assert(drivers.length >= 1, "Expected at least one Bamako driver.");

  if (drivers.length < 2) {
    await createDriverFixture(cityId, "Bamako Reassign");
    drivers = await listBamakoDrivers(cityId);
  }

  let unassignedOrders = await listUnassigned(cityId);
  if (!unassignedOrders.length) {
    await createDispatchableOrderFixture(bamako);
    unassignedOrders = await listUnassigned(cityId);
  }
  assert(unassignedOrders.length >= 1, "Expected at least one unassigned dispatchable Bamako order.");

  const orderId = String(unassignedOrders[0]?.orderId || "");
  const primaryDriverId = String(drivers[0]?.driverId || "");
  const secondaryDriverId =
    String(drivers.find((row) => String(row.driverId) !== primaryDriverId)?.driverId || "") || primaryDriverId;

  assert(orderId, "Missing dispatch order.");
  assert(primaryDriverId, "Missing primary driver.");

  const assign = await request(`/api/ops/dispatch/assign?key=${encodeURIComponent(adminKey)}`, {
    method: "POST",
    body: {
      cityId,
      orderId,
      driverId: primaryDriverId,
      note: "phase4 dispatch smoke assign",
    },
  });
  assert(assign.res.ok && assign.json?.ok, `Assign failed: ${assign.text}`);
  assert(
    assign.json?.assigned === true || assign.json?.idempotent === true,
    "Assign response should be assigned=true or idempotent=true."
  );

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
    historyRows.some((row) => String(row?.action || "") === "DRIVER_ASSIGNED"),
    "History must include DRIVER_ASSIGNED."
  );

  const reassign = await request(`/api/ops/dispatch/reassign?key=${encodeURIComponent(adminKey)}`, {
    method: "POST",
    body: {
      cityId,
      orderId,
      driverId: secondaryDriverId,
      note: "phase4 dispatch smoke reassign",
    },
  });
  assert(reassign.res.ok && reassign.json?.ok, `Reassign failed: ${reassign.text}`);
  if (secondaryDriverId === primaryDriverId) {
    assert(reassign.json?.idempotent === true, "Expected idempotent reassign when reusing the same driver.");
  } else {
    assert(reassign.json?.reassigned === true, "Expected reassigned=true for second driver.");
  }

  const template = await request(`/api/ops/dispatch/whatsapp-template?key=${encodeURIComponent(adminKey)}`, {
    method: "POST",
    body: { orderId },
  });
  assert(template.res.ok && template.json?.ok, `WhatsApp template failed: ${template.text}`);
  assert(String(template.json?.driverLinkUrl || "").startsWith("http"), "driverLinkUrl missing.");
  assert(String(template.json?.messageText || "").trim().length > 10, "messageText missing.");

  const page = await request(`/ops/dispatch?key=${encodeURIComponent(adminKey)}&cityId=${encodeURIComponent(cityId)}`);
  assert(page.res.ok, "Ops dispatch page failed.");
  assert(
    String(page.res.headers.get("content-type") || "").includes("text/html"),
    "Ops dispatch page must return HTML."
  );

  console.log(
    JSON.stringify(
      {
        ok: true,
        cityId,
        orderId,
        driverId: secondaryDriverId || primaryDriverId,
        assigned: Boolean(assign.json?.assigned || assign.json?.idempotent),
        historyCount: historyRows.length,
        hasWhatsappTemplate: true,
      },
      null,
      2
    )
  );
}

main()
  .catch((error) => {
    console.error("Smoke phase4-dispatch failed:", error instanceof Error ? error.message : String(error));
    process.exit(1);
  })
  .finally(async () => {
    try {
      await mongoose.disconnect();
    } catch {
      // no-op
    }
  });
