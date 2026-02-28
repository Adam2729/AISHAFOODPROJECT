/* eslint-disable @typescript-eslint/no-require-imports */
const path = require("node:path");
const mongoose = require("mongoose");
const { spawn, execFileSync } = require("node:child_process");

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

let baseUrl = String(process.env.SMOKE_BASE_URL || "http://localhost:3000").replace(/\/+$/, "");
const adminKey = String(process.env.ADMIN_KEY || "").trim();
const mongoUri = String(process.env.MONGODB_URI || "").trim();
const modeArg = process.argv.find((arg) => arg.startsWith("--mode="));
const mode = String(modeArg ? modeArg.slice("--mode=".length) : "auto").trim().toLowerCase();
const VALID_MODES = new Set(["auto", "enabled", "disabled", "enabled-flip"]);
let activeFlipServer = null;

if (!VALID_MODES.has(mode)) {
  console.error(`Invalid mode "${mode}". Use one of: auto, enabled, disabled, enabled-flip.`);
  process.exit(1);
}

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

function parseCookieHeader(setCookie) {
  if (!setCookie) return "";
  const first = String(setCookie).split(",")[0];
  return first.split(";")[0].trim();
}

function kmToLatOffset(km) {
  return Number(km) / 111.32;
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

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForHealth(url, timeoutMs = 180000, serverRef = null) {
  const startedAt = Date.now();
  let lastError = "";
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const res = await fetch(`${url}/api/health`);
      if (res.ok) return;
      lastError = `status=${res.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    if (serverRef?.exited) {
      const excerpt = serverRef.logs.slice(-30).join("\n");
      throw new Error(
        `Flipped smoke server exited before health became ready. Last error=${lastError}\n${excerpt}`
      );
    }
    await delay(1000);
  }
  const excerpt = serverRef?.logs?.slice?.(-30)?.join?.("\n") || "";
  throw new Error(`Timed out waiting for ${url}/api/health. Last error=${lastError}\n${excerpt}`);
}

function buildFlipServer() {
  const portRaw = Number(process.env.SMOKE_FLIP_PORT || 3011);
  const port = Number.isFinite(portRaw) && portRaw >= 1024 && portRaw <= 65535 ? portRaw : 3011;
  const smokeBaseUrl = `http://localhost:${port}`;
  const isWin = process.platform === "win32";
  const command = isWin ? "cmd.exe" : "npm";
  const devArgs = `-- -p ${String(port)} --distDir .next/smoke-phase2-city`;
  const args = isWin
    ? ["/d", "/s", "/c", `npm run dev ${devArgs}`]
    : ["run", "dev", "--", "-p", String(port), "--distDir", ".next/smoke-phase2-city"];
  const logs = [];

  const child = spawn(command, args, {
    cwd: process.cwd(),
    env: {
      ...process.env,
      MULTICITY_ENABLE_BAMAKO: "true",
      PORT: String(port),
      SMOKE_BASE_URL: smokeBaseUrl,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const serverRef = {
    child,
    logs,
    exited: false,
  };

  function pushLog(prefix, chunk) {
    const text = String(chunk || "")
      .split(/\r?\n/)
      .filter(Boolean);
    for (const line of text) {
      logs.push(`[${prefix}] ${line}`);
      if (logs.length > 200) logs.shift();
    }
  }

  child.stdout.on("data", (chunk) => pushLog("stdout", chunk));
  child.stderr.on("data", (chunk) => pushLog("stderr", chunk));
  child.on("exit", () => {
    serverRef.exited = true;
  });

  return {
    baseUrl: smokeBaseUrl,
    serverRef,
    async stop() {
      if (!child || serverRef.exited) return;
      if (process.platform === "win32") {
        try {
          execFileSync("taskkill", ["/pid", String(child.pid), "/t", "/f"], { stdio: "ignore" });
        } catch {
          // no-op
        }
      } else {
        child.kill("SIGTERM");
      }
      await delay(500);
    },
  };
}

async function requestJson(pathname, options = {}) {
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
  const json = text ? JSON.parse(text) : {};
  return { res, json };
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

async function merchantLoginAndOpenHours(businessId, pin) {
  const loginRes = await fetch(`${baseUrl}/api/merchant/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ businessId, pin }),
  });
  const loginJson = await loginRes.json();
  assert(loginRes.ok, "Merchant login failed.");
  let merchantCookie = parseCookieHeader(loginRes.headers.get("set-cookie"));
  assert(merchantCookie, "Merchant cookie missing.");

  if (Boolean(loginJson.mustChangePin)) {
    const newPin = "5678";
    const setPin = await requestJson("/api/merchant/auth/set-pin", {
      method: "POST",
      cookie: merchantCookie,
      body: { newPin, confirmPin: newPin },
    });
    assert(setPin.res.ok, "set-pin failed.");
    const relogin = await fetch(`${baseUrl}/api/merchant/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ businessId, pin: newPin }),
    });
    assert(relogin.ok, "Merchant re-login failed.");
    merchantCookie = parseCookieHeader(relogin.headers.get("set-cookie"));
    assert(merchantCookie, "Merchant cookie missing after re-login.");
  }

  const forceOpenSettings = await requestJson("/api/merchant/business/settings", {
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
  assert(forceOpenSettings.res.ok, "Failed to set merchant hours.");
  return merchantCookie;
}

async function transitionOrderToDelivered(cookie, orderId, otp) {
  for (const status of ["accepted", "preparing", "ready", "delivered"]) {
    const body = status === "delivered" ? { status, deliveryOtp: otp } : { status };
    const patch = await requestJson(`/api/merchant/orders/${encodeURIComponent(orderId)}`, {
      method: "PATCH",
      cookie,
      body,
    });
    assert(patch.res.ok, `Failed transition to ${status}.`);
  }
}

async function runEnabledSuite(db, bamakoCity) {
  console.log("Running Phase-2 Bamako-enabled smoke...");

  const pin = "1234";
  const bamakoLat = Number(bamakoCity.coverageCenterLat || 12.6392);
  const bamakoLng = Number(bamakoCity.coverageCenterLng || -8.0029);

  const businessCreate = await requestJson(`/api/admin/businesses?key=${encodeURIComponent(adminKey)}`, {
    method: "POST",
    body: {
      type: "restaurant",
      name: randomLabel("BKO-Biz"),
      phone: "22370000001",
      whatsapp: "22370000001",
      address: "Bamako Centre",
      lat: bamakoLat,
      lng: bamakoLng,
      pin,
    },
  });
  assert(businessCreate.res.status === 201, "Business creation failed.");
  const businessId = String(businessCreate.json?.business?._id || "");
  assert(businessId, "Missing businessId.");

  await db.collection("businesses").updateOne(
    { _id: new mongoose.Types.ObjectId(businessId) },
    {
      $set: {
        cityId: new mongoose.Types.ObjectId(String(bamakoCity._id)),
        location: {
          type: "Point",
          coordinates: [bamakoLng, bamakoLat],
        },
      },
    }
  );

  const merchantCookie = await merchantLoginAndOpenHours(businessId, pin);

  const productCreate = await requestJson("/api/merchant/products", {
    method: "POST",
    cookie: merchantCookie,
    body: {
      name: randomLabel("BKO-Product"),
      price: 5000,
      category: "Platos",
      isAvailable: true,
    },
  });
  assert(productCreate.res.status === 201, "Product creation failed.");
  const productId = String(productCreate.json?.product?._id || "");
  assert(productId, "Missing productId.");

  const driverCreate = await requestJson(`/api/admin/drivers?key=${encodeURIComponent(adminKey)}`, {
    method: "POST",
    body: {
      name: randomLabel("BKO-Driver"),
      phoneE164: "22370000002",
      zoneLabel: "Bamako",
      isActive: true,
    },
  });
  assert(driverCreate.res.status === 201, "Driver creation failed.");
  const driverId = String(driverCreate.json?.driver?.id || "");
  assert(driverId, "Missing driverId.");

  async function assertQuote(km, expectedFee, expectedPayout, expectedBandLabel) {
    const coords = coordsAtDistance(bamakoLat, bamakoLng, km);
    const quote = await requestJson(
      `/api/public/delivery/quote?businessId=${encodeURIComponent(businessId)}&lat=${coords.lat}&lng=${coords.lng}`,
      {
        headers: {
          "x-city": String(bamakoCity._id),
        },
      }
    );
    assert(quote.res.ok, `Quote failed at ${km}km.`);
    assert(String(quote.json?.currency || "") === "CFA", `Currency mismatch at ${km}km.`);
    assert(String(quote.json?.model || "") === "customerPays", `Model mismatch at ${km}km.`);
    assert(Number(quote.json?.delivery?.fee || 0) === expectedFee, `Fee mismatch at ${km}km.`);
    assert(
      Number(quote.json?.delivery?.payoutToRider || 0) === expectedPayout,
      `Payout mismatch at ${km}km.`
    );
    if (expectedBandLabel) {
      assert(
        String(quote.json?.delivery?.bandLabel || "") === expectedBandLabel,
        `Band mismatch at ${km}km.`
      );
    }
  }

  async function assertQuoteError(km, expectedCode) {
    const coords = coordsAtDistance(bamakoLat, bamakoLng, km);
    const quote = await requestJson(
      `/api/public/delivery/quote?businessId=${encodeURIComponent(businessId)}&lat=${coords.lat}&lng=${coords.lng}`,
      {
        headers: {
          "x-city": String(bamakoCity._id),
        },
      }
    );
    assert(!quote.res.ok, `Quote should fail at ${km}km.`);
    assert(String(quote.json?.error?.code || "") === expectedCode, `Expected ${expectedCode} at ${km}km.`);
  }

  await assertQuote(2.9, 1000, 1000, "0-3 km");
  await assertQuote(3.0, 1000, 1000, "0-3 km");
  await assertQuote(3.01, 1500, 1200, "3-5 km");
  await assertQuote(8.0, 2000, 1200, "5-8 km");
  await assertQuoteError(8.01, "DELIVERY_FEE_OUT_OF_RANGE");

  const orderCoords = coordsAtDistance(bamakoLat, bamakoLng, 3.01);
  const orderCreate = await requestJson("/api/public/orders", {
    method: "POST",
    headers: {
      "x-city": String(bamakoCity._id),
    },
    body: {
      customerName: "Smoke Bamako Customer",
      phone: "22370000003",
      address: "Quartier Test, Bamako",
      lat: orderCoords.lat,
      lng: orderCoords.lng,
      city: "Bamako",
      cityId: String(bamakoCity._id),
      businessId,
      items: [{ productId, qty: 1 }],
    },
  });
  assert(orderCreate.res.status === 201, `Order create failed (${orderCreate.res.status}).`);

  const orderId = String(orderCreate.json?.orderId || "");
  const orderNumber = String(orderCreate.json?.orderNumber || "");
  const deliveryOtp = String(orderCreate.json?.deliveryOtp || "");
  assert(orderId && orderNumber && deliveryOtp, "Missing order data from create.");
  assert(Number(orderCreate.json?.totals?.deliveryFeeToCustomer || 0) === 1500, "Delivery fee should be 1500.");
  assert(
    Number(orderCreate.json?.totals?.total || 0) ===
      Number(orderCreate.json?.totals?.subtotal || 0) + 1500,
    "Order total mismatch (subtotal + delivery fee)."
  );

  const storedOrder = await db.collection("orders").findOne({ _id: new mongoose.Types.ObjectId(orderId) });
  assert(storedOrder, "Stored order not found.");
  assert(
    Number(storedOrder.deliveryFeeBandAtOrderTime?.fee || 0) === 1500,
    "deliveryFeeBandAtOrderTime missing/invalid."
  );
  assert(
    Number(storedOrder.riderPayoutExpectedAtOrderTime || 0) === 1200,
    "riderPayoutExpectedAtOrderTime missing/invalid."
  );
  assert(
    String(storedOrder.deliveryFeeModelAtOrderTime || "") === "customerPays",
    "deliveryFeeModelAtOrderTime missing/invalid."
  );

  const assign = await requestJson(`/api/admin/dispatch/assign?key=${encodeURIComponent(adminKey)}`, {
    method: "POST",
    body: {
      orderId,
      driverId,
      confirm: "ASSIGN",
    },
  });
  assert(assign.res.ok, "Dispatch assign failed.");

  await transitionOrderToDelivered(merchantCookie, orderId, deliveryOtp);

  const deliveredOrder = await db.collection("orders").findOne({ _id: new mongoose.Types.ObjectId(orderId) });
  assert(String(deliveredOrder?.status || "") === "delivered", "Order not delivered.");
  assert(Boolean(deliveredOrder?.settlement?.counted), "Settlement not counted after delivery.");

  const payoutsAfterFirst = await db
    .collection("riderpayouts")
    .find({ orderId: new mongoose.Types.ObjectId(orderId) })
    .toArray();
  assert(payoutsAfterFirst.length === 1, "RiderPayout should be created exactly once.");

  const deliveredAgain = await requestJson(`/api/merchant/orders/${encodeURIComponent(orderId)}`, {
    method: "PATCH",
    cookie: merchantCookie,
    body: {
      status: "delivered",
      deliveryOtp,
    },
  });
  assert(deliveredAgain.res.ok, "Delivered idempotent PATCH failed.");

  const payoutsAfterSecond = await db
    .collection("riderpayouts")
    .find({ orderId: new mongoose.Types.ObjectId(orderId) })
    .toArray();
  assert(payoutsAfterSecond.length === 1, "RiderPayout should remain single after repeated delivered PATCH.");
  const payoutId = String(payoutsAfterSecond[0]?._id || "");
  assert(payoutId, "Payout id missing.");
  const payout = payoutsAfterSecond[0] || {};
  assert(Number(payout.amount || 0) === 1200, "RiderPayout amount mismatch.");
  assert(Number(payout.deliveryFeeCharged || 0) === 1500, "RiderPayout deliveryFeeCharged mismatch.");
  assert(Number(payout.platformMargin || 0) === 300, "RiderPayout platformMargin mismatch.");
  assert(String(payout.status || "") === "pending", "RiderPayout initial status should be pending.");
  assert(
    String(payout.weekKey || "") === getWeekKey(new Date()),
    "RiderPayout weekKey should use delivery week."
  );

  const markPaid = await requestJson(
    `/api/admin/rider-payouts/${encodeURIComponent(payoutId)}/mark-paid?key=${encodeURIComponent(adminKey)}`,
    {
      method: "POST",
      body: {
        note: "Smoke mark paid",
        paidByAdminId: "smoke-admin",
      },
    }
  );
  assert(markPaid.res.ok, "Mark-paid failed.");
  assert(String(markPaid.json?.payout?.status || "") === "paid", "Payout should be paid.");
  assert(String(markPaid.json?.payout?.paidAt || "").length > 10, "paidAt should be set.");

  const markPaidAgain = await requestJson(
    `/api/admin/rider-payouts/${encodeURIComponent(payoutId)}/mark-paid?key=${encodeURIComponent(adminKey)}`,
    {
      method: "POST",
      body: {
        note: "Smoke mark paid again",
      },
    }
  );
  if (markPaidAgain.res.ok) {
    assert(String(markPaidAgain.json?.payout?.status || "") === "paid", "Second mark-paid should keep paid status.");
  } else {
    assert(markPaidAgain.res.status === 409, "Second mark-paid should be idempotent or 409.");
  }

  const invariants = await requestJson(
    `/api/admin/rider-payouts/invariants?key=${encodeURIComponent(adminKey)}&limit=100&cityId=${encodeURIComponent(
      String(bamakoCity._id)
    )}`
  );
  assert(invariants.res.ok, "Rider payout invariants endpoint failed.");
  const violations = Array.isArray(invariants.json?.violations) ? invariants.json.violations : [];
  const payoutViolations = violations.filter(
    (row) => String(row?.payoutId || "") === payoutId
  );
  assert(payoutViolations.length === 0, "New payout violates invariants.");

  console.log(
    JSON.stringify(
      {
        mode: "enabled",
        bamakoCityId: String(bamakoCity._id),
        businessId,
        orderId,
        driverId,
        payoutId,
      },
      null,
      2
    )
  );
}

async function runDisabledSuite(db, bamakoCity) {
  console.log("Running Phase-2 Bamako-disabled smoke...");

  const cityCollection = db.collection("cities");
  const bamakoId = new mongoose.Types.ObjectId(String(bamakoCity._id));
  const original = await cityCollection.findOne({ _id: bamakoId });
  assert(original, "Bamako city document missing.");

  try {
    // Force active=true to verify runtime env guard blocks city usage even if data is active.
    await cityCollection.updateOne({ _id: bamakoId }, { $set: { isActive: true } });

    const publicCities = await requestJson("/api/public/cities");
    assert(publicCities.res.ok, "Public cities request failed.");
    const rows = Array.isArray(publicCities.json?.cities) ? publicCities.json.cities : [];
    const bamakoInPublic = rows.some((row) => String(row?.code || "").toUpperCase() === "BKO");
    assert(!bamakoInPublic, "Bamako must be excluded from public cities when disabled.");

    const guardCheck = await requestJson(
      `/api/public/delivery/quote?businessId=${encodeURIComponent(
        "000000000000000000000000"
      )}&lat=12.6392&lng=-8.0029`,
      {
        headers: {
          "x-city": String(bamakoCity._id),
        },
      }
    );
    assert(!guardCheck.res.ok, "Runtime city guard should block direct Bamako cityId.");
    assert(guardCheck.res.status === 403, "Runtime city guard should return 403.");
    assert(String(guardCheck.json?.error?.code || "") === "CITY_DISABLED", "Expected CITY_DISABLED.");
  } finally {
    await cityCollection.updateOne(
      { _id: bamakoId },
      {
        $set: {
          isActive: Boolean(original.isActive),
        },
      }
    );
  }

  console.log(
    JSON.stringify(
      {
        mode: "disabled",
        bamakoCityId: String(bamakoCity._id),
      },
      null,
      2
    )
  );
}

async function main() {
  let flipServer = null;
  if (mode === "enabled-flip") {
    flipServer = buildFlipServer();
    activeFlipServer = flipServer;
    baseUrl = flipServer.baseUrl;
    console.log(`Starting flipped smoke backend at ${baseUrl} with MULTICITY_ENABLE_BAMAKO=true ...`);
    await waitForHealth(baseUrl, 240000, flipServer.serverRef);
  }
  console.log(`Running Phase-2 city smoke against ${baseUrl} (mode=${mode})`);

  const health = await requestJson("/api/health");
  assert(health.res.ok, "Health check failed.");

  await requestJson(`/api/admin/maintenance?key=${encodeURIComponent(adminKey)}`, {
    method: "POST",
    body: { enabled: false },
  });

  const seeded = await requestJson(`/api/admin/jobs/seed-cities?key=${encodeURIComponent(adminKey)}`, {
    method: "POST",
  });
  assert(seeded.res.ok, "Seed cities failed.");

  const adminCities = await requestJson(`/api/admin/cities?key=${encodeURIComponent(adminKey)}`);
  assert(adminCities.res.ok, "Admin cities request failed.");
  const cities = Array.isArray(adminCities.json?.cities) ? adminCities.json.cities : [];
  const bamakoCity =
    cities.find((row) => String(row?.code || "").toUpperCase() === "BKO") ||
    cities.find((row) => String(row?.name || "").toLowerCase() === "bamako");
  assert(bamakoCity?._id, "Bamako city is missing.");

  const publicCities = await requestJson("/api/public/cities");
  assert(publicCities.res.ok, "Public cities request failed.");
  const publicRows = Array.isArray(publicCities.json?.cities) ? publicCities.json.cities : [];
  const bamakoPublic = publicRows.some((row) => String(row?.code || "").toUpperCase() === "BKO");

  await mongoose.connect(mongoUri);
  const db = mongoose.connection.db;
  assert(db, "Mongo connection missing.");

  const bamakoId = new mongoose.Types.ObjectId(String(bamakoCity._id));
  const bamakoOriginal = await db.collection("cities").findOne({ _id: bamakoId });
  assert(bamakoOriginal, "Bamako city document missing.");
  let restoreBamakoActive = null;

  try {
    if (mode === "enabled" || mode === "enabled-flip") {
      if (!Boolean(bamakoOriginal.isActive)) {
        restoreBamakoActive = Boolean(bamakoOriginal.isActive);
        await db.collection("cities").updateOne({ _id: bamakoId }, { $set: { isActive: true } });
      }
      const publicCitiesEnabled = await requestJson("/api/public/cities");
      assert(publicCitiesEnabled.res.ok, "Public cities request failed (enabled check).");
      const enabledRows = Array.isArray(publicCitiesEnabled.json?.cities) ? publicCitiesEnabled.json.cities : [];
      const bamakoEnabled = enabledRows.some((row) => String(row?.code || "").toUpperCase() === "BKO");
      assert(bamakoEnabled, "Mode=enabled requires Bamako to be publicly active.");
      await runEnabledSuite(db, bamakoCity);
    } else if (mode === "disabled") {
      assert(!bamakoPublic, "Mode=disabled requires Bamako to be hidden from public list.");
      await runDisabledSuite(db, bamakoCity);
    } else {
      if (bamakoPublic) {
        await runEnabledSuite(db, bamakoCity);
      } else {
        await runDisabledSuite(db, bamakoCity);
      }
    }
  } finally {
    if (restoreBamakoActive != null) {
      await db
        .collection("cities")
        .updateOne({ _id: bamakoId }, { $set: { isActive: Boolean(restoreBamakoActive) } });
    }
    if (flipServer) {
      await flipServer.stop();
      activeFlipServer = null;
    }
  }

  console.log("Smoke phase2-city passed.");
}

main()
  .catch((error) => {
    console.error("Smoke phase2-city failed:", error instanceof Error ? error.message : String(error));
    process.exit(1);
  })
  .finally(async () => {
    if (activeFlipServer) {
      try {
        await activeFlipServer.stop();
      } catch {
        // no-op
      }
      activeFlipServer = null;
    }
    try {
      await mongoose.disconnect();
    } catch {
      // no-op
    }
  });
