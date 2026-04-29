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

function cityPhonePrefix(city) {
  return String(city?.code || "").toUpperCase() === "BKO" ? "2237" : "1809";
}

function cityCoords(city) {
  if (String(city?.code || "").toUpperCase() === "BKO") {
    return { lat: 12.6392, lng: -8.0029 };
  }
  return { lat: 18.4861, lng: -69.9312 };
}

async function request(pathname, options = {}) {
  const method = options.method || "GET";
  const headers = {};
  if (options.body !== undefined) {
    headers["Content-Type"] = "application/json";
  }
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

async function ensureRestaurant(city) {
  const cityId = String(city._id);
  const existing = await request(
    `/api/public/restaurants?${new URLSearchParams({ cityId, limit: "50", skip: "0" }).toString()}`,
    {
      headers: { "x-city-id": cityId },
    }
  );
  assert(existing.res.ok && existing.json?.ok, `Restaurant list failed: ${existing.text}`);

  const existingRows = Array.isArray(existing.json?.rows) ? existing.json.rows : [];
  if (existingRows.length > 0) {
    return {
      businessId: String(existingRows[0].restaurantId),
      name: String(existingRows[0].name || ""),
    };
  }

  const coords = cityCoords(city);
  const create = await request(`/api/admin/businesses?key=${encodeURIComponent(adminKey)}`, {
    method: "POST",
    body: {
      type: "restaurant",
      name: randomLabel("P12-ADS-BIZ"),
      phone: randomPhone(cityPhonePrefix(city)),
      whatsapp: randomPhone(cityPhonePrefix(city)),
      address: `${city.name || city.code || "City"} Ads Center`,
      lat: coords.lat,
      lng: coords.lng,
      pin: "1234",
      isDemo: true,
    },
  });
  assert(create.res.ok && create.json?.ok, `Business creation failed: ${create.text}`);

  const businessId = String(create.json?.business?._id || "");
  assert(businessId, "Missing businessId after business creation.");

  await mongoose.connection.db.collection("businesses").updateOne(
    { _id: new mongoose.Types.ObjectId(businessId) },
    {
      $set: {
        cityId: new mongoose.Types.ObjectId(cityId),
        isActive: true,
        location: {
          type: "Point",
          coordinates: [coords.lng, coords.lat],
        },
      },
    }
  );

  return {
    businessId,
    name: String(create.json?.business?.name || ""),
  };
}

async function main() {
  console.log(`Running Phase-12 ads smoke against ${baseUrl}`);

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

  const [publicCities, adminCities] = await Promise.all([
    request("/api/public/cities"),
    request(`/api/admin/cities?key=${encodeURIComponent(adminKey)}`),
  ]);
  assert(publicCities.res.ok && publicCities.json?.ok, `Public cities failed: ${publicCities.text}`);
  assert(adminCities.res.ok && adminCities.json?.ok, `Admin cities failed: ${adminCities.text}`);

  const publicRows = Array.isArray(publicCities.json?.cities) ? publicCities.json.cities : [];
  const adminRows = Array.isArray(adminCities.json?.cities) ? adminCities.json.cities : [];
  assert(publicRows.length > 0, "Expected at least one active public city.");

  const selectedPublicCity = publicRows[0];
  const selectedCity =
    adminRows.find((row) => String(row._id) === String(selectedPublicCity._id)) ||
    adminRows.find((row) => String(row.code || "") === String(selectedPublicCity.code || ""));
  assert(selectedCity?._id, "Could not match selected city.");

  await mongoose.connect(mongoUri);

  const cityId = String(selectedCity._id);
  const restaurant = await ensureRestaurant(selectedCity);

  const today = new Date();
  const end = new Date();
  end.setDate(end.getDate() + 5);

  const campaignCreate = await request(`/api/admin/ads?key=${encodeURIComponent(adminKey)}`, {
    method: "POST",
    body: {
      cityId,
      businessId: restaurant.businessId,
      name: randomLabel("P12-ADS-CAMPAIGN"),
      dailyBudget: 300,
      totalBudget: 3000,
      startDate: today.toISOString(),
      endDate: end.toISOString(),
      priority: 7,
    },
  });
  assert(campaignCreate.res.ok && campaignCreate.json?.ok, `Campaign create failed: ${campaignCreate.text}`);

  const campaignId = String(campaignCreate.json?.campaign?.id || "");
  assert(campaignId, "Missing campaignId.");

  const restaurantList = await request(
    `/api/public/restaurants?${new URLSearchParams({ cityId, limit: "50", skip: "0" }).toString()}`,
    {
      headers: { "x-city-id": cityId },
    }
  );
  assert(restaurantList.res.ok && restaurantList.json?.ok, `Restaurant list failed: ${restaurantList.text}`);

  const listRows = Array.isArray(restaurantList.json?.rows) ? restaurantList.json.rows : [];
  const sponsoredRow = listRows.find(
    (row) =>
      String(row.restaurantId || "") === restaurant.businessId &&
      Boolean(row.sponsored) &&
      String(row.campaignId || "") === campaignId
  );
  assert(Boolean(sponsoredRow), "Expected sponsored restaurant to appear in the public list.");

  const clickResponse = await request("/api/public/ads/click", {
    method: "POST",
    headers: { "x-city-id": cityId },
    body: {
      cityId,
      campaignId,
      businessId: restaurant.businessId,
    },
  });
  assert(clickResponse.res.ok && clickResponse.json?.ok, `Click tracking failed: ${clickResponse.text}`);

  const campaignList = await request(
    `/api/admin/ads?key=${encodeURIComponent(adminKey)}&cityId=${encodeURIComponent(cityId)}`
  );
  assert(campaignList.res.ok && campaignList.json?.ok, `Campaign list failed: ${campaignList.text}`);

  const campaignRows = Array.isArray(campaignList.json?.rows) ? campaignList.json.rows : [];
  const updatedCampaign = campaignRows.find((row) => String(row.id || "") === campaignId);
  assert(updatedCampaign, "Updated campaign not found.");
  assert(Number(updatedCampaign.spent || 0) > 0, "Expected campaign spent to increase after click.");
  assert(Number(updatedCampaign.clicks || 0) > 0, "Expected campaign click count to increase.");

  console.log(
    JSON.stringify(
      {
        ok: true,
        campaignId,
        sponsoredRestaurant: true,
        clickTracked: true,
      },
      null,
      2
    )
  );
}

main()
  .catch((error) => {
    console.error(
      "Smoke phase12-ads failed:",
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
