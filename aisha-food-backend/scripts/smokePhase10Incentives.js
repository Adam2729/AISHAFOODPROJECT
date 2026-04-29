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

async function listDrivers(cityId) {
  const params = new URLSearchParams({ key: adminKey, cityId, limit: "200" });
  const drivers = await request(`/api/ops/dispatch/drivers?${params.toString()}`);
  assert(drivers.res.ok && drivers.json?.ok, `Drivers endpoint failed: ${drivers.text}`);
  return Array.isArray(drivers.json?.rows) ? drivers.json.rows : [];
}

async function createDriverFixture(cityId) {
  const driverCreate = await request(`/api/admin/drivers?key=${encodeURIComponent(adminKey)}`, {
    method: "POST",
    body: {
      name: randomLabel("P10-DRIVER"),
      phoneE164: `+${randomPhone("2237")}`,
      zoneLabel: "Bamako Incentive Zone",
      isActive: true,
      cityId,
    },
  });
  assert(driverCreate.res.status === 201, `Driver creation failed: ${driverCreate.text}`);
  return String(driverCreate.json?.driver?.id || "");
}

async function createRestaurantFixture(city) {
  const pin = "1234";
  const businessCreate = await request(`/api/admin/businesses?key=${encodeURIComponent(adminKey)}`, {
    method: "POST",
    body: {
      type: "restaurant",
      name: randomLabel("P10-INC-BIZ"),
      phone: randomPhone("2237"),
      whatsapp: randomPhone("2237"),
      address: "Bamako Incentive Centre",
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
      name: randomLabel("P10-INC-PROD"),
      price: 2200,
      category: "Phase 10",
      description: "Driver incentive smoke product",
      isAvailable: true,
    },
  });
  assert(productCreate.res.status === 201, `Product creation failed: ${productCreate.text}`);
  const productId = String(productCreate.json?.product?._id || "");
  assert(productId, "Missing productId.");

  return {
    businessId,
    merchantCookie,
    productId,
  };
}

async function updateOrderStatus(orderId, status, merchantCookie, deliveryOtp) {
  const body = { status };
  if (status === "delivered") {
    body.deliveryOtp = deliveryOtp;
  }
  const response = await request(`/api/merchant/orders/${encodeURIComponent(orderId)}`, {
    method: "PATCH",
    cookie: merchantCookie,
    body,
  });
  assert(response.res.ok && response.json?.ok, `Order status ${status} failed: ${response.text}`);
  return response.json;
}

async function main() {
  console.log(`Running Phase-10 incentives smoke against ${baseUrl}`);

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
  let drivers = await listDrivers(cityId);
  if (!drivers.length) {
    const createdId = await createDriverFixture(cityId);
    assert(createdId, "Driver fixture creation failed.");
    drivers = await listDrivers(cityId);
  }
  assert(drivers.length >= 1, "Expected at least one active Bamako driver.");

  const driverId = String(drivers[0].driverId || "");
  assert(driverId, "Driver list did not include a driverId.");

  const fixture = await createRestaurantFixture(bamako);
  const orderCreate = await request("/api/public/orders", {
    method: "POST",
    headers: {
      "x-city-id": cityId,
    },
    body: {
      cityId,
      restaurantId: String(fixture.businessId),
      items: [
        {
          itemId: String(fixture.productId),
          name: "Phase10 Incentive Item",
          quantity: 1,
          price: 2200,
        },
      ],
      customerName: "Phase10 Incentive Customer",
      phone: randomPhone("2237"),
      address: "Bamako incentive smoke address",
      notes: "phase10 incentive smoke",
    },
  });
  assert(orderCreate.res.ok && orderCreate.json?.ok, `Order create failed: ${orderCreate.text}`);

  const orderId = String(orderCreate.json?.orderId || "");
  const deliveryOtp = String(orderCreate.json?.deliveryOtp || "");
  assert(orderId, "Missing orderId from create order.");
  assert(deliveryOtp, "Missing deliveryOtp from create order.");

  const ruleCreate = await request(`/api/admin/incentives?key=${encodeURIComponent(adminKey)}`, {
    method: "POST",
    body: {
      cityId,
      name: randomLabel("P10 WEEKLY DELIVERIES"),
      type: "deliveries_count",
      threshold: 1,
      rewardAmount: 500,
      period: "weekly",
      notes: "phase10 incentives smoke",
    },
  });
  assert(ruleCreate.res.status === 201 && ruleCreate.json?.ok, `Rule create failed: ${ruleCreate.text}`);
  const ruleId = String(ruleCreate.json?.rule?.ruleId || "");
  assert(ruleId, "Missing ruleId from create incentive rule.");

  await updateOrderStatus(orderId, "accepted", fixture.merchantCookie);
  await updateOrderStatus(orderId, "preparing", fixture.merchantCookie);
  await updateOrderStatus(orderId, "ready", fixture.merchantCookie);

  const assign = await request(`/api/ops/dispatch/assign?key=${encodeURIComponent(adminKey)}`, {
    method: "POST",
    body: {
      cityId,
      orderId,
      driverId,
      note: "phase10 incentive smoke",
    },
  });
  assert(assign.res.ok && assign.json?.ok, `Assign driver failed: ${assign.text}`);
  assert(assign.json?.assigned === true || assign.json?.idempotent === true, "Driver assignment failed.");

  await updateOrderStatus(orderId, "delivered", fixture.merchantCookie, deliveryOtp);

  const earnedDoc = await mongoose.connection.db.collection("driverincentiveearneds").findOne({
    cityId: new mongoose.Types.ObjectId(cityId),
    driverId: new mongoose.Types.ObjectId(driverId),
    ruleId: new mongoose.Types.ObjectId(ruleId),
  });
  assert(earnedDoc, "DriverIncentiveEarned was not created.");

  const driverToken = createDriverLinkToken(driverId, cityId);
  const incentives = await request(
    `/api/driver/incentives?cityId=${encodeURIComponent(cityId)}&period=current&token=${encodeURIComponent(driverToken)}`
  );
  assert(incentives.res.ok && incentives.json?.ok, `Driver incentives endpoint failed: ${incentives.text}`);
  assert(Number(incentives.json?.totals?.earnedTotal || 0) >= 500, "Expected earnedTotal to be at least 500.");

  console.log(
    JSON.stringify(
      {
        ok: true,
        driverId,
        incentiveEarned: Number(earnedDoc.rewardAmount || 0),
      },
      null,
      2
    )
  );
}

main()
  .catch((error) => {
    console.error(
      "Smoke phase10-incentives failed:",
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
