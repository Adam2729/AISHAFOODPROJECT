/* eslint-disable @typescript-eslint/no-require-imports */
const path = require("node:path");

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
    // ignore
  }
}

loadEnvForScript();

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
  console.log(`Phase-4 merchant onboarding smoke against ${baseUrl}`);

  // Cities
  const cities = await request(`/api/admin/cities?key=${encodeURIComponent(adminKey)}`);
  assert(cities.res.ok && cities.json?.ok, "Failed to load cities.");
  const rows = Array.isArray(cities.json?.cities) ? cities.json.cities : [];
  const bamako =
    rows.find((c) => String(c.code || "").toUpperCase() === "BKO") ||
    rows.find((c) => String(c.name || "").toLowerCase() === "bamako");
  assert(bamako?._id, "Bamako city not found.");
  const cityId = String(bamako._id);

  // Apply
  const appName = `Smoke Bistro ${Date.now()}`;
  const apply = await request("/api/public/merchant-applications", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-city-id": cityId },
    body: {
      businessName: appName,
      ownerName: "Smoke Owner",
      phone: "+22370000000",
      whatsapp: "+22370000001",
      address: "Test street",
      cuisineType: "Grill",
    },
  });
  assert(apply.res.ok && apply.json?.ok && apply.json?.applicationId, `Apply failed: ${apply.text}`);
  const applicationId = String(apply.json.applicationId);

  // List
  const list = await request(
    `/api/admin/merchant-applications?key=${encodeURIComponent(adminKey)}&cityId=${encodeURIComponent(
      cityId
    )}&status=pending`
  );
  assert(list.res.ok && list.json?.ok, "Admin list failed.");

  // Approve
  const approve = await request(
    `/api/admin/merchant-applications/${encodeURIComponent(applicationId)}/approve?key=${encodeURIComponent(adminKey)}`,
    { method: "POST" }
  );
  assert(approve.res.ok && approve.json?.ok && approve.json?.businessId, `Approve failed: ${approve.text}`);
  const businessId = String(approve.json.businessId);

  // Verify business exists
  const businesses = await request(`/api/admin/businesses?key=${encodeURIComponent(adminKey)}`);
  assert(businesses.res.ok && businesses.json?.ok, "Admin businesses failed.");
  const found = (businesses.json?.businesses || []).some(
    (b) => String(b.id || b._id || "") === businessId || String(b.name || "") === appName
  );
  assert(found, "Created business not found.");

  // Reject path
  const rejectName = `Smoke Reject ${Date.now()}`;
  const rejectApply = await request("/api/public/merchant-applications", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-city-id": cityId },
    body: {
      businessName: rejectName,
      ownerName: "Reject Owner",
      phone: "+22370000002",
    },
  });
  assert(
    rejectApply.res.ok && rejectApply.json?.ok && rejectApply.json?.applicationId,
    `Reject apply failed: ${rejectApply.text}`
  );
  const rejectAppId = String(rejectApply.json.applicationId);

  const reject = await request(
    `/api/admin/merchant-applications/${encodeURIComponent(rejectAppId)}/reject?key=${encodeURIComponent(adminKey)}`,
    { method: "POST", headers: { "Content-Type": "application/json" }, body: { reason: "Smoke test reject" } }
  );
  assert(reject.res.ok && reject.json?.ok, `Reject failed: ${reject.text}`);

  console.log(
    JSON.stringify(
      {
        ok: true,
        cityId,
        applicationId,
        businessId,
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
