/* eslint-disable @typescript-eslint/no-require-imports */
const path = require("node:path");

function loadEnv() {
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
    // ignore
  }
}
loadEnv();

const baseUrl = String(process.env.SMOKE_BASE_URL || "http://localhost:3000").replace(/\/+$/, "");
const adminKey = String(process.env.ADMIN_KEY || "").trim();

if (!adminKey) {
  console.error("Missing ADMIN_KEY env var.");
  process.exit(1);
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function request(pathname, options = {}) {
  const res = await fetch(`${baseUrl}${pathname}`, {
    method: options.method || "GET",
    headers: options.headers || {},
    body: options.body ? JSON.stringify(options.body) : undefined,
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

async function ensureDriver(cityId) {
  const list = await request(
    `/api/admin/driver-applications?key=${encodeURIComponent(adminKey)}&cityId=${encodeURIComponent(
      cityId
    )}&status=pending&limit=1`
  );
  if (list.res.ok && list.json?.ok && list.json.rows?.length) {
    const appId = list.json.rows[0]._id;
    const approve = await request(
      `/api/admin/driver-applications/${encodeURIComponent(appId)}/approve?key=${encodeURIComponent(adminKey)}`,
      { method: "POST" }
    );
    if (approve.res.ok && approve.json?.driverId) return approve.json.driverId;
  }
  // create application then approve
  const apply = await request("/api/public/driver-applications", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-city-id": cityId },
    body: {
      name: `SmokeAdminDrv ${Date.now()}`,
      phone: "+22370002001",
      whatsapp: "+22370002001",
      motorbike: true,
      licenseNumber: "LIC-ADMIN",
      zonePreference: "Central",
    },
  });
  assert(apply.res.ok && apply.json?.applicationId, `Apply failed: ${apply.text}`);
  const approve = await request(
    `/api/admin/driver-applications/${encodeURIComponent(apply.json.applicationId)}/approve?key=${encodeURIComponent(
      adminKey
    )}`,
    { method: "POST" }
  );
  assert(approve.res.ok && approve.json?.driverId, `Approve failed: ${approve.text}`);
  return approve.json.driverId;
}

async function main() {
  console.log(`Phase-4 driver admin smoke against ${baseUrl}`);

  // city
  const cities = await request(`/api/admin/cities?key=${encodeURIComponent(adminKey)}`);
  assert(cities.res.ok && cities.json?.ok, "Cities failed.");
  const rows = Array.isArray(cities.json?.cities) ? cities.json.cities : [];
  const bamako =
    rows.find((c) => String(c.code || "").toUpperCase() === "BKO") ||
    rows.find((c) => String(c.name || "").toLowerCase() === "bamako");
  assert(bamako?._id, "Bamako not found.");
  const cityId = String(bamako._id);

  const driverId = await ensureDriver(cityId);

  // ban
  const ban = await request(
    `/api/admin/drivers/${encodeURIComponent(driverId)}/ban?cityId=${encodeURIComponent(cityId)}&key=${encodeURIComponent(
      adminKey
    )}`,
    { method: "POST", headers: { "Content-Type": "application/json" }, body: { reason: "smoke ban" } }
  );
  assert(ban.res.ok && ban.json?.ok && ban.json?.isBanned === true, `Ban failed: ${ban.text}`);

  // activate should fail while banned
  const activateWhileBanned = await request(
    `/api/admin/drivers/${encodeURIComponent(driverId)}/activate?cityId=${encodeURIComponent(cityId)}&key=${encodeURIComponent(
      adminKey
    )}`,
    { method: "POST" }
  );
  assert(activateWhileBanned.res.status === 409, "Activate while banned should fail.");

  // unban
  const unban = await request(
    `/api/admin/drivers/${encodeURIComponent(driverId)}/unban?cityId=${encodeURIComponent(cityId)}&key=${encodeURIComponent(
      adminKey
    )}`,
    { method: "POST" }
  );
  assert(unban.res.ok && unban.json?.ok, `Unban failed: ${unban.text}`);

  // activate
  const activate = await request(
    `/api/admin/drivers/${encodeURIComponent(driverId)}/activate?cityId=${encodeURIComponent(cityId)}&key=${encodeURIComponent(
      adminKey
    )}`,
    { method: "POST" }
  );
  assert(activate.res.ok && activate.json?.ok && activate.json?.isActive === true, `Activate failed: ${activate.text}`);

  // pause
  const pause = await request(
    `/api/admin/drivers/${encodeURIComponent(driverId)}/pause?cityId=${encodeURIComponent(cityId)}&key=${encodeURIComponent(
      adminKey
    )}`,
    { method: "POST", headers: { "Content-Type": "application/json" }, body: { reason: "smoke pause" } }
  );
  assert(pause.res.ok && pause.json?.ok && pause.json?.pausedAt, `Pause failed: ${pause.text}`);

  // unpause
  const unpause = await request(
    `/api/admin/drivers/${encodeURIComponent(driverId)}/unpause?cityId=${encodeURIComponent(cityId)}&key=${encodeURIComponent(
      adminKey
    )}`,
    { method: "POST" }
  );
  assert(unpause.res.ok && unpause.json?.ok, `Unpause failed: ${unpause.text}`);

  // list
  const list = await request(
    `/api/admin/drivers?cityId=${encodeURIComponent(cityId)}&key=${encodeURIComponent(adminKey)}`
  );
  assert(list.res.ok && list.json?.ok, "List drivers failed.");

  console.log(
    JSON.stringify(
      {
        ok: true,
        cityId,
        driverId,
        banned: true,
        paused: false,
      },
      null,
      2
    )
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
