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

async function main() {
  console.log(`Phase-4 driver onboarding smoke against ${baseUrl}`);

  // Public cities to get Bamako
  const cities = await request("/api/public/cities");
  assert(cities.res.ok, "public cities failed");
  const rows = Array.isArray(cities.json) ? cities.json : cities.json?.cities || [];
  const bamako =
    rows.find((c) => String(c.code || "").toUpperCase() === "BKO") ||
    rows.find((c) => String(c.name || "").toLowerCase() === "bamako");
  assert(bamako?._id, "Bamako city not found.");
  const cityId = String(bamako._id);

  // Apply (approve path)
  const apply = await request("/api/public/driver-applications", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-city-id": cityId },
    body: {
      name: `SmokeDrv ${Date.now()}`,
      phone: "+22371000001",
      zoneLabel: "Central",
    },
  });
  assert(apply.res.ok && apply.json?.applicationId, `apply failed: ${apply.text}`);
  const applicationId = String(apply.json.applicationId);

  // List pending
  const list = await request(
    `/api/admin/driver-applications?cityId=${encodeURIComponent(cityId)}&key=${encodeURIComponent(adminKey)}`
  );
  assert(list.res.ok && list.json?.ok, "admin list failed");

  // Approve
  const approve = await request(
    `/api/admin/driver-applications/${encodeURIComponent(applicationId)}/approve?key=${encodeURIComponent(adminKey)}`,
    { method: "POST" }
  );
  assert(approve.res.ok && approve.json?.ok && approve.json?.driverId, `approve failed: ${approve.text}`);
  const driverId = String(approve.json.driverId);

  // Reject path
  const rejectApply = await request("/api/public/driver-applications", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-city-id": cityId },
    body: {
      name: `SmokeDrvReject ${Date.now()}`,
      phone: "+22371000002",
      zoneLabel: "North",
    },
  });
  assert(rejectApply.res.ok && rejectApply.json?.applicationId, `reject apply failed: ${rejectApply.text}`);
  const rejectAppId = String(rejectApply.json.applicationId);

  const reject = await request(
    `/api/admin/driver-applications/${encodeURIComponent(rejectAppId)}/reject?key=${encodeURIComponent(adminKey)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: { reason: "Smoke reject" },
    }
  );
  assert(reject.res.ok && reject.json?.ok, `reject failed: ${reject.text}`);

  console.log(
    JSON.stringify(
      {
        ok: true,
        cityId,
        applicationId,
        driverId,
        rejectedApplicationId: rejectAppId,
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
