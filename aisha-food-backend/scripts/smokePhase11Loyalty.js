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

function randomPhone(prefix) {
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

function cityTimezone(city) {
  return String(city?.code || "").toUpperCase() === "BKO" ? "Africa/Bamako" : "America/Santo_Domingo";
}

function cityPhonePrefix(city) {
  return String(city?.code || "").toUpperCase() === "BKO" ? "2237" : "1809";
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

async function merchantLoginAndOpenHours(businessId, pin, timezone) {
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
        timezone,
        weekly: allDayWeekly(),
      },
    },
  });
  assert(settings.res.ok, `Failed to set merchant hours: ${settings.text}`);
  return merchantCookie;
}

async function createRestaurantFixture(city) {
  const pin = "1234";
  const businessCreate = await request(`/api/admin/businesses?key=${encodeURIComponent(adminKey)}`, {
    method: "POST",
    body: {
      type: "restaurant",
      name: randomLabel("P11-LOYALTY-BIZ"),
      phone: randomPhone(cityPhonePrefix(city)),
      whatsapp: randomPhone(cityPhonePrefix(city)),
      address: `${city.name || "City"} Centre`,
      lat: Number(city.coverageCenterLat || 18.4861),
      lng: Number(city.coverageCenterLng || -69.9312),
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
          coordinates: [Number(city.coverageCenterLng || -69.9312), Number(city.coverageCenterLat || 18.4861)],
        },
      },
    }
  );

  const merchantCookie = await merchantLoginAndOpenHours(businessId, pin, cityTimezone(city));
  const productCreate = await request("/api/merchant/products", {
    method: "POST",
    cookie: merchantCookie,
    body: {
      name: randomLabel("P11-LOYALTY-PROD"),
      price: 600,
      category: "Phase 11",
      description: "Loyalty smoke menu item",
      isAvailable: true,
    },
  });
  assert(productCreate.res.status === 201, `Product creation failed: ${productCreate.text}`);

  return {
    businessId,
    merchantCookie,
    productId: String(productCreate.json?.product?._id || ""),
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
}

async function main() {
  console.log(`Running Phase-11 loyalty smoke against ${baseUrl}`);

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
  assert(publicRows.length >= 1, "Expected at least one active public city.");

  const selectedPublicCity = publicRows[0];
  const selectedCity =
    adminRows.find((row) => String(row._id) === String(selectedPublicCity._id)) ||
    adminRows.find((row) => String(row.code || "") === String(selectedPublicCity.code || ""));
  assert(selectedCity?._id, "Could not match active public city.");

  await mongoose.connect(mongoUri);

  const cityId = String(selectedCity._id);
  const referrerPhone = randomPhone(cityPhonePrefix(selectedCity));
  const referredPhone = randomPhone(cityPhonePrefix(selectedCity));

  const referrerBefore = await request(
    `/api/public/loyalty?${new URLSearchParams({ cityId, phone: referrerPhone }).toString()}`,
    {
      headers: { "x-city-id": cityId },
    }
  );
  assert(referrerBefore.res.ok && referrerBefore.json?.ok, `Referrer loyalty failed: ${referrerBefore.text}`);
  const referrerCode = String(referrerBefore.json?.referralCode || "");
  assert(referrerCode, "Missing referrerCode.");
  const walletBefore = Number(referrerBefore.json?.walletBalance || 0);

  const fixture = await createRestaurantFixture(selectedCity);
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
          name: "Phase11 Loyalty Item",
          quantity: 1,
          price: 600,
        },
      ],
      customerName: "Phase11 Loyalty Customer",
      phone: referredPhone,
      address: `${selectedCity.name || "City"} loyalty smoke address`,
      notes: "phase11 loyalty smoke",
      referralCode: referrerCode,
    },
  });
  assert(orderCreate.res.ok && orderCreate.json?.ok, `Order create failed: ${orderCreate.text}`);

  const orderId = String(orderCreate.json?.orderId || "");
  const deliveryOtp = String(orderCreate.json?.deliveryOtp || "");
  assert(orderId, "Missing orderId.");
  assert(deliveryOtp, "Missing deliveryOtp.");

  await updateOrderStatus(orderId, "accepted", fixture.merchantCookie);
  await updateOrderStatus(orderId, "preparing", fixture.merchantCookie);
  await updateOrderStatus(orderId, "ready", fixture.merchantCookie);
  await updateOrderStatus(orderId, "delivered", fixture.merchantCookie, deliveryOtp);

  const referrerAfter = await request(
    `/api/public/loyalty?${new URLSearchParams({ cityId, phone: referrerPhone }).toString()}`,
    {
      headers: { "x-city-id": cityId },
    }
  );
  assert(referrerAfter.res.ok && referrerAfter.json?.ok, `Referrer loyalty reload failed: ${referrerAfter.text}`);
  const walletAfter = Number(referrerAfter.json?.walletBalance || 0);

  const referralEvent = await mongoose.connection.db.collection("loyaltyevents").findOne({
    cityId: new mongoose.Types.ObjectId(cityId),
    eventType: "referral_reward",
    orderId: new mongoose.Types.ObjectId(orderId),
  });

  const referredLoyalty = await request(
    `/api/public/loyalty?${new URLSearchParams({ cityId, phone: referredPhone }).toString()}`,
    {
      headers: { "x-city-id": cityId },
    }
  );
  assert(referredLoyalty.res.ok && referredLoyalty.json?.ok, `Referred loyalty failed: ${referredLoyalty.text}`);
  const referredCustomerPoints = Number(referredLoyalty.json?.points || 0);

  assert(
    walletAfter > walletBefore || Boolean(referralEvent),
    "Expected referrer wallet balance to increase or referral loyalty event to exist."
  );
  assert(referredCustomerPoints > 0, "Expected referred customer loyalty points to be greater than zero.");

  console.log(
    JSON.stringify(
      {
        ok: true,
        referrerCode,
        referrerWalletRewarded: walletAfter > walletBefore,
        referredCustomerPoints,
      },
      null,
      2
    )
  );
}

main()
  .catch((error) => {
    console.error(
      "Smoke phase11-loyalty failed:",
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
