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
const mode = String(modeArg ? modeArg.slice("--mode=".length) : "enabled").trim().toLowerCase();
const VALID_MODES = new Set(["enabled", "enabled-flip"]);

const BAMAKO_SPEC = {
  currency: "CFA",
  maxDeliveryRadiusKm: 8,
  coverageCenterLat: 12.6392,
  coverageCenterLng: -8.0029,
  deliveryFeeModel: "customerPays",
  deliveryFeeBands: [
    { minKm: 0, maxKm: 3, fee: 1000 },
    { minKm: 3, maxKm: 5, fee: 1500 },
    { minKm: 5, maxKm: 8, fee: 2000 },
  ],
  deliveryFeeCurrency: "CFA",
  riderPayoutModel: "perDelivery",
  riderPayoutFlat: 1200,
  platformDeliveryMargin: 200,
};

if (!VALID_MODES.has(mode)) {
  console.error(`Invalid mode "${mode}". Use one of: enabled, enabled-flip.`);
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

function randomPhone() {
  const tail = Math.floor(Math.random() * 1000000)
    .toString()
    .padStart(6, "0");
  return `2237${tail}`;
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
  const portRaw = Number(process.env.SMOKE_FLIP_PORT || 3012);
  const port = Number.isFinite(portRaw) && portRaw >= 1024 && portRaw <= 65535 ? portRaw : 3012;
  const smokeBaseUrl = `http://localhost:${port}`;
  const isWin = process.platform === "win32";
  const command = isWin ? "cmd.exe" : "npm";
  const args = isWin
    ? ["/d", "/s", "/c", `npm run dev -- -p ${String(port)}`]
    : ["run", "dev", "--", "-p", String(port)];
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
  const serverRef = { child, logs, exited: false };

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

async function request(pathname, options = {}) {
  const method = options.method || "GET";
  const headers = {};
  if (options.body !== undefined) headers["Content-Type"] = "application/json";
  if (options.cookie) headers.Cookie = options.cookie;
  if (options.headers && typeof options.headers === "object") {
    Object.assign(headers, options.headers);
  }

  return fetch(`${baseUrl}${pathname}`, {
    method,
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });
}

async function requestJson(pathname, options = {}) {
  const res = await request(pathname, options);
  const text = await res.text();
  const json = text ? JSON.parse(text) : {};
  return { res, json, text };
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
  const loginRes = await requestJson("/api/merchant/auth/login", {
    method: "POST",
    body: { businessId, pin },
  });
  assert(loginRes.res.ok, "Merchant login failed.");
  let merchantCookie = parseCookieHeader(loginRes.res.headers.get("set-cookie"));
  assert(merchantCookie, "Merchant cookie missing.");

  if (Boolean(loginRes.json.mustChangePin)) {
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
  assert(settings.res.ok, "Failed to set merchant hours.");
  return merchantCookie;
}

async function transitionOrderToDelivered(cookie, orderId, otp) {
  for (const status of ["accepted", "preparing", "ready", "delivered"]) {
    const payload = status === "delivered" ? { status, deliveryOtp: otp } : { status };
    const patch = await requestJson(`/api/merchant/orders/${encodeURIComponent(orderId)}`, {
      method: "PATCH",
      cookie,
      body: payload,
    });
    assert(patch.res.ok, `Failed transition to ${status}.`);
  }
}

async function main() {
  let flipServer = null;
  if (mode === "enabled-flip") {
    flipServer = buildFlipServer();
    baseUrl = flipServer.baseUrl;
    console.log(`Starting flipped smoke backend at ${baseUrl} with MULTICITY_ENABLE_BAMAKO=true ...`);
    await waitForHealth(baseUrl, 240000, flipServer.serverRef);
  }

  console.log(`Running Phase-3 payouts smoke against ${baseUrl} (mode=${mode})`);

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

  await mongoose.connect(mongoUri);
  const db = mongoose.connection.db;
  assert(db, "Mongo connection missing.");

  const bamakoId = new mongoose.Types.ObjectId(String(bamakoCity._id));
  const bamakoOriginal = await db.collection("cities").findOne({ _id: bamakoId });
  assert(bamakoOriginal, "Bamako city document missing.");

  const restoreBamakoSnapshot = {
    isActive: Boolean(bamakoOriginal.isActive),
    currency: bamakoOriginal.currency,
    maxDeliveryRadiusKm: bamakoOriginal.maxDeliveryRadiusKm,
    coverageCenterLat: bamakoOriginal.coverageCenterLat,
    coverageCenterLng: bamakoOriginal.coverageCenterLng,
    deliveryFeeModel: bamakoOriginal.deliveryFeeModel,
    deliveryFeeBands: Array.isArray(bamakoOriginal.deliveryFeeBands) ? bamakoOriginal.deliveryFeeBands : [],
    deliveryFeeCurrency: bamakoOriginal.deliveryFeeCurrency,
    riderPayoutModel: bamakoOriginal.riderPayoutModel,
    riderPayoutFlat: bamakoOriginal.riderPayoutFlat,
    platformDeliveryMargin: bamakoOriginal.platformDeliveryMargin,
  };

  try {
    await db.collection("cities").updateOne(
      { _id: bamakoId },
      {
        $set: {
          ...BAMAKO_SPEC,
          isActive: true,
        },
      }
    );

    const publicCities = await requestJson("/api/public/cities");
    assert(publicCities.res.ok, "Public cities request failed.");
    const publicRows = Array.isArray(publicCities.json?.cities) ? publicCities.json.cities : [];
    const bamakoPublic = publicRows.some((row) => String(row?.code || "").toUpperCase() === "BKO");
    assert(
      bamakoPublic,
      "Mode=enabled requires Bamako to be publicly active. Ensure MULTICITY_ENABLE_BAMAKO=true and restart the backend."
    );

    const bamakoLat = Number(bamakoCity.coverageCenterLat || 12.6392);
    const bamakoLng = Number(bamakoCity.coverageCenterLng || -8.0029);
    const pin = "1234";
    const businessPhone = randomPhone();
    const driverPhone = randomPhone();
    const customerPhone = randomPhone();

    const businessCreate = await requestJson(`/api/admin/businesses?key=${encodeURIComponent(adminKey)}`, {
      method: "POST",
      body: {
        type: "restaurant",
        name: randomLabel("P3-BKO-Biz"),
        phone: businessPhone,
        whatsapp: businessPhone,
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
        name: randomLabel("P3-BKO-Product"),
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
        name: randomLabel("P3-BKO-Driver"),
        phoneE164: driverPhone,
        zoneLabel: "Bamako",
        isActive: true,
      },
    });
    assert(driverCreate.res.status === 201, "Driver creation failed.");
    const driverId = String(driverCreate.json?.driver?.id || "");
    assert(driverId, "Missing driverId.");

    const orderCoords = coordsAtDistance(bamakoLat, bamakoLng, 3.01);
    const orderCreate = await requestJson("/api/public/orders", {
      method: "POST",
      headers: {
        "x-city": String(bamakoCity._id),
      },
      body: {
        customerName: "Phase3 Bamako Customer",
        phone: customerPhone,
        address: "Quartier Test, Bamako",
        lat: orderCoords.lat,
        lng: orderCoords.lng,
        city: "Bamako",
        cityId: String(bamakoCity._id),
        businessId,
        items: [{ productId, qty: 1 }],
      },
    });
    assert(
      orderCreate.res.status === 201,
      `Order creation failed (status=${orderCreate.res.status}): ${orderCreate.text || JSON.stringify(orderCreate.json || {})}`
    );
    const orderId = String(orderCreate.json?.orderId || "");
    const deliveryOtp = String(orderCreate.json?.deliveryOtp || "");
    assert(orderId && deliveryOtp, "Missing orderId or deliveryOtp.");

    const assign = await requestJson(`/api/admin/dispatch/assign?key=${encodeURIComponent(adminKey)}`, {
      method: "POST",
      body: { orderId, driverId, confirm: "ASSIGN" },
    });
    assert(assign.res.ok, "Dispatch assign failed.");

    await transitionOrderToDelivered(merchantCookie, orderId, deliveryOtp);

    const payout = await db.collection("riderpayouts").findOne({ orderId: new mongoose.Types.ObjectId(orderId) });
    assert(payout, "RiderPayout was not created.");
    assert(String(payout.status || "") === "pending", "RiderPayout should start pending.");
    assert(String(payout.weekKey || "") === getWeekKey(new Date()), "RiderPayout weekKey mismatch.");

    const upsertBatch = await requestJson(`/api/admin/rider-payout-batches/upsert?key=${encodeURIComponent(adminKey)}`, {
      method: "POST",
      body: {
        cityId: String(bamakoCity._id),
        weekKey: String(payout.weekKey || ""),
      },
    });
    assert(upsertBatch.res.ok, "Batch upsert failed.");
    const batchId = String(upsertBatch.json?.batch?.id || "");
    assert(batchId, "Batch id missing after upsert.");

    const csvRes = await request(
      `/api/admin/rider-payout-batches/${encodeURIComponent(batchId)}/export?key=${encodeURIComponent(adminKey)}`
    );
    assert(csvRes.ok, "CSV export failed.");
    const csvText = await csvRes.text();
    const lines = csvText.split(/\r?\n/).filter(Boolean);
    assert(lines.length >= 2, "CSV export should include header + at least one row.");
    const headerLine = lines.find((line) => line.startsWith("cityCode,weekKey,payoutId,"));
    assert(
      headerLine ===
        "cityCode,weekKey,payoutId,orderId,driverId,driverRef,businessId,amount,deliveryFeeCharged,platformMargin,status,createdAt,paidAt",
      "CSV header mismatch."
    );

    const payBatch = await requestJson(
      `/api/admin/rider-payout-batches/${encodeURIComponent(batchId)}/pay?key=${encodeURIComponent(adminKey)}`,
      {
        method: "POST",
        body: {},
      }
    );
    assert(
      payBatch.res.ok,
      `Batch pay failed (status=${payBatch.res.status}): ${payBatch.text || JSON.stringify(payBatch.json || {})}`
    );
    assert(String(payBatch.json?.batch?.status || "") === "paid", "Batch should be paid.");

    const invariants = await requestJson(
      `/api/admin/rider-payouts/invariants?key=${encodeURIComponent(adminKey)}&cityId=${encodeURIComponent(
        String(bamakoCity._id)
      )}&batchId=${encodeURIComponent(batchId)}&limit=1000`
    );
    assert(invariants.res.ok, "Invariants endpoint failed.");
    assert(Number(invariants.json?.violationsCount || 0) === 0, "Invariants must have zero violations.");

    console.log(
      JSON.stringify(
        {
          mode,
          cityId: String(bamakoCity._id),
          businessId,
          orderId,
          payoutId: String(payout._id),
          batchId,
          weekKey: String(payout.weekKey || ""),
          csvRows: Math.max(0, lines.filter((line) => !line.startsWith("#")).length - 1),
          violationsCount: Number(invariants.json?.violationsCount || 0),
        },
        null,
        2
      )
    );
    console.log("Smoke phase3-payouts passed.");
  } finally {
    await db.collection("cities").updateOne({ _id: bamakoId }, { $set: restoreBamakoSnapshot });
    if (flipServer) {
      await flipServer.stop();
    }
  }
}

main()
  .catch((error) => {
    console.error("Smoke phase3-payouts failed:", error instanceof Error ? error.message : String(error));
    process.exit(1);
  })
  .finally(async () => {
    try {
      await mongoose.disconnect();
    } catch {
      // no-op
    }
  });
