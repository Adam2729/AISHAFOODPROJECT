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

function hasMobileMoney(city) {
  const methods = Array.isArray(city?.paymentMethods) ? city.paymentMethods : [];
  return methods.some((value) =>
    ["mobilemoney", "orangemoney", "moovmoney", "wave", "wavemoney"].includes(
      String(value || "")
        .trim()
        .toLowerCase()
        .replace(/[^a-z]/g, "")
    )
  );
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

async function listRestaurants(cityId, q = "") {
  const params = new URLSearchParams({
    cityId,
    limit: "50",
    skip: "0",
  });
  if (q) params.set("q", q);
  const restaurants = await request(`/api/public/restaurants?${params.toString()}`);
  assert(restaurants.res.ok && restaurants.json?.ok, `Restaurants endpoint failed: ${restaurants.text}`);
  return Array.isArray(restaurants.json?.rows) ? restaurants.json.rows : [];
}

async function loadMenu(cityId, slug) {
  const menu = await request(
    `/api/public/restaurants/${encodeURIComponent(slug)}/menu?cityId=${encodeURIComponent(cityId)}`
  );
  assert(menu.res.ok && menu.json?.ok, `Restaurant menu failed: ${menu.text}`);
  return menu.json;
}

async function createRestaurantFixture(city) {
  const pin = "1234";
  const businessCreate = await request(`/api/admin/businesses?key=${encodeURIComponent(adminKey)}`, {
    method: "POST",
    body: {
      type: "restaurant",
      name: randomLabel("P7-PAY-BIZ"),
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
      name: randomLabel("P7-PAY-PROD"),
      price: 425,
      category: "Phase 7",
      description: "Payments smoke item",
      isAvailable: true,
    },
  });
  assert(productCreate.res.status === 201, `Product creation failed: ${productCreate.text}`);

  return {
    businessId,
    productId: String(productCreate.json?.product?._id || ""),
  };
}

async function ensureRestaurantWithMenu(city) {
  let restaurants = await listRestaurants(String(city._id));
  for (const restaurant of restaurants) {
    const menu = await loadMenu(String(city._id), String(restaurant.slug));
    if (Array.isArray(menu.menu) && menu.menu.length) {
      return {
        restaurant,
        menu,
      };
    }
  }

  const fixture = await createRestaurantFixture(city);
  restaurants = await listRestaurants(String(city._id), "P7-PAY-BIZ");
  const restaurant =
    restaurants.find((row) => String(row.restaurantId) === String(fixture.businessId)) || restaurants[0];
  assert(restaurant?.restaurantId, "Could not locate created restaurant fixture.");
  const menu = await loadMenu(String(city._id), String(restaurant.slug));
  assert(Array.isArray(menu.menu) && menu.menu.length, "Fixture restaurant menu is empty.");

  return {
    restaurant,
    menu,
  };
}

async function createOrder(cityId, restaurantId, item, phonePrefix, paymentMethod) {
  const response = await request("/api/public/orders", {
    method: "POST",
    headers: {
      "x-city-id": cityId,
    },
    body: {
      cityId,
      restaurantId,
      items: [
        {
          itemId: String(item.itemId),
          name: String(item.name || "Menu item"),
          quantity: 1,
          price: Number(item.price || 0),
        },
      ],
      customerName: `Phase7 ${paymentMethod} Customer`,
      phone: randomPhone(phonePrefix),
      address: "Phase 7 payment smoke address",
      notes: "phase7 payments smoke",
      paymentMethod,
    },
  });
  assert(response.res.ok && response.json?.ok, `Order create failed: ${response.text}`);
  return String(response.json?.orderId || "");
}

async function getPayment(cityId, orderId) {
  const response = await request(
    `/api/public/orders/${encodeURIComponent(orderId)}/payment?cityId=${encodeURIComponent(cityId)}`
  );
  assert(response.res.ok && response.json?.ok, `Payment status failed: ${response.text}`);
  return response.json;
}

async function main() {
  console.log(`Running Phase-7 payments smoke against ${baseUrl}`);

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

  if (!hasMobileMoney(selectedCity)) {
    await mongoose.connection.db.collection("cities").updateOne(
      { _id: new mongoose.Types.ObjectId(String(selectedCity._id)) },
      {
        $set: {
          paymentMethods: ["cash", "orangeMoney"],
        },
      }
    );
    selectedCity.paymentMethods = ["cash", "orangeMoney"];
  }

  const { restaurant, menu } = await ensureRestaurantWithMenu(selectedCity);
  const firstItem = Array.isArray(menu.menu) ? menu.menu[0] : null;
  assert(firstItem?.itemId, "Expected a menu item for ordering.");

  const cityId = String(selectedCity._id);
  const phonePrefix = cityPhonePrefix(selectedCity);

  const cashOrderId = await createOrder(
    cityId,
    String(restaurant.restaurantId),
    firstItem,
    phonePrefix,
    "cash"
  );
  assert(cashOrderId, "Missing cash orderId.");

  const cashPaymentBefore = await getPayment(cityId, cashOrderId);
  assert(String(cashPaymentBefore.payment?.method || "") === "cash", "Expected cash payment method.");
  assert(String(cashPaymentBefore.payment?.status || "") === "pending", "Expected cash payment to start pending.");

  const markPaid = await request(
    `/api/admin/orders/${encodeURIComponent(cashOrderId)}/payment?key=${encodeURIComponent(adminKey)}&cityId=${encodeURIComponent(cityId)}`,
    {
      method: "POST",
      body: {
        status: "paid",
        provider: "cash_collection",
        reference: `cash-${Date.now()}`,
        notes: "phase7 payments smoke paid",
      },
    }
  );
  assert(markPaid.res.ok && markPaid.json?.ok, `Admin mark paid failed: ${markPaid.text}`);

  const cashPaymentAfter = await getPayment(cityId, cashOrderId);
  assert(String(cashPaymentAfter.payment?.status || "") === "paid", "Expected cash payment to be paid.");

  const mobileMoneyOrderId = await createOrder(
    cityId,
    String(restaurant.restaurantId),
    firstItem,
    phonePrefix,
    "mobile_money"
  );
  assert(mobileMoneyOrderId, "Missing mobile money orderId.");

  const mobilePayment = await getPayment(cityId, mobileMoneyOrderId);
  assert(
    String(mobilePayment.payment?.method || "") === "mobile_money",
    "Expected mobile money payment method."
  );
  assert(
    String(mobilePayment.payment?.status || "") === "pending",
    "Expected mobile money payment to stay pending."
  );
  assert(
    Array.isArray(mobilePayment.events) &&
      mobilePayment.events.some(
        (event) =>
          String(event.method || "") === "mobile_money" &&
          String(event.status || "") === "pending"
      ),
    "Expected a pending mobile money payment event."
  );

  console.log(
    JSON.stringify(
      {
        ok: true,
        cashOrderId,
        mobileMoneyOrderId,
        cashStatusAfter: String(cashPaymentAfter.payment?.status || ""),
        mobileMoneyStatus: String(mobilePayment.payment?.status || ""),
      },
      null,
      2
    )
  );
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect().catch(() => undefined);
    }
  });
