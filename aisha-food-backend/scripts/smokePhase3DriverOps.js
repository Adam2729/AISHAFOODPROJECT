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

function getWeekKey(dateInput = new Date()) {
  const date = new Date(Date.UTC(dateInput.getUTCFullYear(), dateInput.getUTCMonth(), dateInput.getUTCDate()));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((date.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
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

async function requestSummary(cityId, weekKey) {
  const summary = await request(
    `/api/ops/driver-ops/summary?key=${encodeURIComponent(adminKey)}&cityId=${encodeURIComponent(
      cityId
    )}&weekKey=${encodeURIComponent(weekKey)}`
  );
  assert(summary.res.ok && summary.json?.ok, `Summary failed: ${summary.text}`);
  const totals = summary.json?.summary || {};
  const drivers = Array.isArray(summary.json?.drivers) ? summary.json.drivers : [];
  return {
    drivers,
    totals: {
      pendingCount: Number(totals.pendingCount || 0),
      pendingAmount: Number(totals.pendingAmount || 0),
      paidCount: Number(totals.paidCount || 0),
      paidAmount: Number(totals.paidAmount || 0),
    },
  };
}

async function requestDriver(cityId, weekKey, driverId, status) {
  const driver = await request(
    `/api/ops/driver-ops/driver?key=${encodeURIComponent(adminKey)}&cityId=${encodeURIComponent(
      cityId
    )}&weekKey=${encodeURIComponent(weekKey)}&driverId=${encodeURIComponent(
      driverId
    )}&status=${encodeURIComponent(status)}`
  );
  assert(driver.res.ok && driver.json?.ok, `Driver endpoint failed: ${driver.text}`);
  return {
    rows: Array.isArray(driver.json?.rows) ? driver.json.rows : [],
  };
}

async function requestCityWeekCsv(cityId, weekKey) {
  const cityCsv = await request(
    `/api/ops/driver-ops/export/city-week.csv?key=${encodeURIComponent(
      adminKey
    )}&cityId=${encodeURIComponent(cityId)}&weekKey=${encodeURIComponent(weekKey)}`
  );
  assert(cityCsv.res.ok, `City/week CSV export failed: ${cityCsv.text}`);
  assert(
    String(cityCsv.res.headers.get("content-type") || "").includes("text/csv"),
    "City/week CSV content-type mismatch."
  );
  const lines = cityCsv.text.split(/\r?\n/).filter(Boolean);
  assert(lines.length >= 1, "City/week CSV missing header.");
  assert(
    lines[0].startsWith("weekKey,cityCode,payoutId,orderId,businessId,driverId,driverRef,status,amount"),
    "City/week CSV header mismatch."
  );
  return lines;
}

async function requestDriverWeekCsv(cityId, weekKey, driverId) {
  const driverCsv = await request(
    `/api/ops/driver-ops/export/driver-week.csv?key=${encodeURIComponent(
      adminKey
    )}&cityId=${encodeURIComponent(cityId)}&weekKey=${encodeURIComponent(weekKey)}&driverId=${encodeURIComponent(
      driverId
    )}`
  );
  assert(driverCsv.res.ok, `Driver/week CSV export failed: ${driverCsv.text}`);
  assert(
    String(driverCsv.res.headers.get("content-type") || "").includes("text/csv"),
    "Driver/week CSV content-type mismatch."
  );
  const lines = driverCsv.text.split(/\r?\n/).filter(Boolean);
  assert(lines.length >= 1, "Driver/week CSV missing header.");
  assert(
    lines[0].startsWith("weekKey,cityCode,payoutId,orderId,businessId,driverId,driverRef,status,amount"),
    "Driver/week CSV header mismatch."
  );
  return lines;
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

async function createPendingPayoutInWeek({ cityId, cityLat, cityLng, weekKey }) {
  await request(`/api/admin/maintenance?key=${encodeURIComponent(adminKey)}`, {
    method: "POST",
    body: { enabled: false },
  });

  const businessCreate = await request(`/api/admin/businesses?key=${encodeURIComponent(adminKey)}`, {
    method: "POST",
    body: {
      type: "restaurant",
      name: randomLabel("P3-DRVOPS-BIZ"),
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
      name: randomLabel("P3-DRVOPS-PROD"),
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
      name: randomLabel("P3-DRVOPS-DRIVER"),
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
      customerName: "Phase3 DriverOps Customer",
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
  const deliveryOtp = String(orderCreate.json?.deliveryOtp || "");
  assert(orderId && deliveryOtp, "Missing orderId or deliveryOtp.");

  const assign = await request(`/api/admin/dispatch/assign?key=${encodeURIComponent(adminKey)}`, {
    method: "POST",
    body: { orderId, driverId, confirm: "ASSIGN" },
  });
  assert(assign.res.ok, `Dispatch assign failed: ${assign.text}`);

  for (const status of ["accepted", "preparing", "ready", "delivered"]) {
    const body = status === "delivered" ? { status, deliveryOtp } : { status };
    const patch = await request(`/api/merchant/orders/${encodeURIComponent(orderId)}`, {
      method: "PATCH",
      cookie: merchantCookie,
      body,
    });
    assert(patch.res.ok, `Transition to ${status} failed: ${patch.text}`);
  }

  const payout = await mongoose.connection.db.collection("riderpayouts").findOne({
    orderId: new mongoose.Types.ObjectId(orderId),
  });
  assert(payout, "RiderPayout was not created.");
  assert(String(payout.status || "") === "pending", "RiderPayout should be pending.");
  assert(String(payout.weekKey || "") === weekKey, "RiderPayout weekKey mismatch.");

  return {
    payoutId: String(payout._id),
    orderId,
    driverId: String(payout.driverId || driverId),
    amount: Number(payout.amount || 0),
    weekKey: String(payout.weekKey || ""),
  };
}

async function main() {
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

  const publicCodes = new Set(publicRows.map((row) => String(row?.code || "").toUpperCase()));
  const bamakoAdmin =
    adminRows.find((row) => String(row?.code || "").toUpperCase() === "BKO") || null;
  assert(bamakoAdmin?._id, "Bamako city missing in admin cities.");
  assert(
    publicCodes.has("BKO"),
    "Bamako is not publicly active. Set MULTICITY_ENABLE_BAMAKO=true and restart backend."
  );

  const cityId = String(bamakoAdmin._id);
  const cityCode = "BKO";
  const weekKey = getWeekKey(new Date());
  const cityLat = Number(bamakoAdmin.coverageCenterLat || 12.6392);
  const cityLng = Number(bamakoAdmin.coverageCenterLng || -8.0029);

  await mongoose.connect(mongoUri);

  const before = await requestSummary(cityId, weekKey);

  const created = await createPendingPayoutInWeek({ cityId, cityLat, cityLng, weekKey });

  const afterCreate = await requestSummary(cityId, weekKey);
  assert(
    afterCreate.totals.pendingCount === before.totals.pendingCount + 1,
    "pendingCount did not increment by 1 after creating pending payout."
  );
  assert(
    afterCreate.totals.pendingAmount === before.totals.pendingAmount + created.amount,
    "pendingAmount did not increment by payout amount."
  );

  const opsDashboardPage = await request(
    `/ops/driver-ops?key=${encodeURIComponent(adminKey)}&cityId=${encodeURIComponent(
      cityId
    )}&weekKey=${encodeURIComponent(weekKey)}`
  );
  assert(opsDashboardPage.res.ok, "Ops dashboard page failed.");
  assert(
    String(opsDashboardPage.res.headers.get("content-type") || "").includes("text/html"),
    "Ops dashboard page must return HTML."
  );

  const driverBeforePayPending = await requestDriver(cityId, weekKey, created.driverId, "pending");
  const driverBeforePayPaid = await requestDriver(cityId, weekKey, created.driverId, "paid");

  const opsDriverPage = await request(
    `/ops/driver-ops/${encodeURIComponent(created.driverId)}?key=${encodeURIComponent(
      adminKey
    )}&cityId=${encodeURIComponent(cityId)}&weekKey=${encodeURIComponent(weekKey)}`
  );
  assert(opsDriverPage.res.ok, "Ops driver detail page failed.");
  assert(
    String(opsDriverPage.res.headers.get("content-type") || "").includes("text/html"),
    "Ops driver detail page must return HTML."
  );

  const cityCsvLines = await requestCityWeekCsv(cityId, weekKey);
  const driverCsvLines = await requestDriverWeekCsv(cityId, weekKey, created.driverId);

  const markPaid = await request(
    `/api/ops/driver-ops/bulk-pay?key=${encodeURIComponent(adminKey)}&cityId=${encodeURIComponent(cityId)}`,
    {
      method: "POST",
      body: {
        cityId,
        weekKey,
        payoutIds: [created.payoutId],
        note: "phase3-driverops-smoke",
      },
    }
  );
  assert(markPaid.res.ok && markPaid.json?.ok, `mark-paid-bulk failed: ${markPaid.text}`);

  const updatedCount = Number(markPaid.json?.updatedCount || 0);
  const skippedCount = Number(markPaid.json?.skippedCount || 0);
  assert(updatedCount === 1, "Expected bulk updatedCount=1.");
  assert(skippedCount === 0, "Expected bulk skippedCount=0.");

  const afterPay = await requestSummary(cityId, weekKey);
  assert(
    afterPay.totals.pendingCount === afterCreate.totals.pendingCount - 1,
    "pendingCount did not decrement by 1 after bulk pay."
  );
  assert(
    afterPay.totals.paidCount === afterCreate.totals.paidCount + 1,
    "paidCount did not increment by 1 after bulk pay."
  );
  assert(
    afterPay.totals.paidAmount === afterCreate.totals.paidAmount + created.amount,
    "paidAmount did not increment by payout amount after bulk pay."
  );

  const driverAfterPayPending = await requestDriver(cityId, weekKey, created.driverId, "pending");
  const driverAfterPayPaid = await requestDriver(cityId, weekKey, created.driverId, "paid");

  console.log(
    JSON.stringify(
      {
        cityId,
        cityCode,
        weekKey,
        created: {
          payoutId: created.payoutId,
          orderId: created.orderId,
          driverId: created.driverId,
          amount: created.amount,
        },
        before: before.totals,
        afterCreate: afterCreate.totals,
        afterPay: afterPay.totals,
        driver: {
          pendingBeforePay: driverBeforePayPending.rows.length,
          paidBeforePay: driverBeforePayPaid.rows.length,
          pendingAfterPay: driverAfterPayPending.rows.length,
          paidAfterPay: driverAfterPayPaid.rows.length,
        },
        exports: {
          cityWeekLines: cityCsvLines.length,
          driverWeekLines: driverCsvLines.length,
        },
        bulk: {
          requestedCount: 1,
          updatedCount,
          skippedCount,
        },
      },
      null,
      2
    )
  );
  console.log("Smoke phase3-driverops passed.");
}

main()
  .catch((error) => {
    console.error("Smoke phase3-driverops failed:", error instanceof Error ? error.message : String(error));
    process.exit(1);
  })
  .finally(async () => {
    try {
      await mongoose.disconnect();
    } catch {
      // no-op
    }
  });
