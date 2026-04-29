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
    // env may already be loaded
  }
}

loadEnvForScript();

const baseUrl = String(process.env.SMOKE_BASE_URL || "http://localhost:3000").replace(/\/+$/, "");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function requestJson(pathname, options) {
  const method = options?.method || "GET";
  const headers = {
    "Content-Type": "application/json",
    ...(options?.headers || {}),
  };

  const res = await fetch(`${baseUrl}${pathname}`, {
    method,
    headers,
    body: options?.body ? JSON.stringify(options.body) : undefined,
  });

  const text = await res.text();
  const json = text ? JSON.parse(text) : {};
  return { res, json };
}

async function main() {
  console.log(`Running user profile smoke against ${baseUrl}`);

  const health = await requestJson("/api/health");
  assert(health.res.ok, "Health check failed.");

  const phone = "8095557878";
  const session = await requestJson("/api/public/user/session", {
    method: "POST",
    body: { phone },
  });
  assert(session.res.ok, "Session creation failed.");
  assert(session.json?.ok, "Session response not ok.");
  const sessionToken = String(session.json?.sessionToken || "");
  assert(sessionToken, "Missing session token.");

  const authHeaders = { "x-user-session": sessionToken };
  const firstGet = await requestJson("/api/user/profile", {
    headers: authHeaders,
  });
  assert(firstGet.res.ok, "Profile GET failed.");
  assert(firstGet.json?.ok, "Profile GET response not ok.");

  const patch = await requestJson("/api/user/profile", {
    method: "PATCH",
    headers: authHeaders,
    body: {
      displayName: "Smoke User",
      city: "Santo Domingo",
      preferredLanguage: "es",
      marketingOptIn: true,
      favoriteCuisines: ["empanadas", "jugos", "picapollo"],
    },
  });
  assert(patch.res.ok, "Profile PATCH failed.");
  assert(patch.json?.ok, "Profile PATCH response not ok.");

  const secondGet = await requestJson("/api/user/profile", {
    headers: authHeaders,
  });
  assert(secondGet.res.ok, "Profile GET after patch failed.");
  assert(secondGet.json?.ok, "Profile GET after patch response not ok.");
  assert(String(secondGet.json?.profile?.displayName || "") === "Smoke User", "displayName did not persist.");
  assert(String(secondGet.json?.profile?.city || "") === "Santo Domingo", "city did not persist.");
  assert(Boolean(secondGet.json?.profile?.marketingOptIn) === true, "marketingOptIn did not persist.");

  const unauthorized = await requestJson("/api/user/profile");
  assert(unauthorized.res.status === 401, "Unauthorized GET should return 401.");

  console.log("Smoke user profile passed.");
  console.log(
    JSON.stringify(
      {
        phone,
        profileId: String(secondGet.json?.profile?.id || ""),
        preferredLanguage: String(secondGet.json?.profile?.preferredLanguage || ""),
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error("Smoke user profile failed:", error instanceof Error ? error.message : String(error));
  process.exit(1);
});
