/* eslint-disable @typescript-eslint/no-require-imports */
const path = require("node:path");
const { execFileSync } = require("node:child_process");

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

if (!adminKey) {
  console.error("Missing ADMIN_KEY env var.");
  process.exit(1);
}

function getWeekKey(dateInput = new Date()) {
  const date = new Date(Date.UTC(dateInput.getUTCFullYear(), dateInput.getUTCMonth(), dateInput.getUTCDate()));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((date.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

function getDayKey(dateInput = new Date()) {
  return dateInput.toISOString().slice(0, 10);
}

async function request(pathname, options) {
  const method = options?.method || "GET";
  const headers = {
    "Content-Type": "application/json",
    ...(options?.headers || {}),
  };
  const response = await fetch(`${baseUrl}${pathname}`, {
    method,
    headers,
    body: options?.body ? JSON.stringify(options.body) : undefined,
  });
  return response;
}

async function requestJson(pathname, options) {
  const response = await request(pathname, options);
  const text = await response.text();
  const json = text ? JSON.parse(text) : {};
  return { response, json, text };
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function runJobs(weekKey, dayKey) {
  const anomalies = await requestJson(
    `/api/admin/jobs/finance-anomalies?key=${encodeURIComponent(adminKey)}&weekKey=${encodeURIComponent(
      weekKey
    )}`,
    { method: "POST" }
  );
  assert(anomalies.response.ok, "Finance anomalies job failed.");
  assert(Boolean(anomalies.json?.ok), "Finance anomalies response not ok.");

  const alertsJob = await requestJson(
    `/api/admin/jobs/finance-alerts?key=${encodeURIComponent(adminKey)}&weekKey=${encodeURIComponent(
      weekKey
    )}&dayKey=${encodeURIComponent(dayKey)}`,
    { method: "POST" }
  );
  assert(alertsJob.response.ok, "Finance alerts job failed.");
  assert(Boolean(alertsJob.json?.ok), "Finance alerts job response not ok.");
  return {
    anomalies: anomalies.json,
    alertsJob: alertsJob.json,
  };
}

async function fetchDigestAndAlerts(weekKey, dayKey) {
  const digest = await requestJson(
    `/api/admin/finance/digest?key=${encodeURIComponent(adminKey)}&weekKey=${encodeURIComponent(
      weekKey
    )}&dayKey=${encodeURIComponent(dayKey)}`
  );
  assert(digest.response.ok, "Finance digest endpoint failed.");
  assert(Boolean(digest.json?.ok), "Finance digest response not ok.");
  assert(typeof digest.json?.messageEs === "string" && digest.json.messageEs.trim().length > 0, "Digest messageEs missing.");

  const alerts = await requestJson(
    `/api/admin/finance/alerts?key=${encodeURIComponent(adminKey)}&weekKey=${encodeURIComponent(
      weekKey
    )}&status=open&limit=50`
  );
  assert(alerts.response.ok, "Finance alerts endpoint failed.");
  assert(Boolean(alerts.json?.ok), "Finance alerts response not ok.");
  assert(Array.isArray(alerts.json?.alerts), "Finance alerts list missing.");

  return { digest: digest.json, alerts: alerts.json };
}

async function main() {
  console.log(`Running finance alerts smoke against ${baseUrl}`);

  const health = await requestJson("/api/health");
  assert(health.response.ok, "Health check failed.");

  const weekKey = getWeekKey(new Date());
  const dayKey = getDayKey(new Date());

  const firstRun = await runJobs(weekKey, dayKey);
  let payload = await fetchDigestAndAlerts(weekKey, dayKey);
  let alerts = Array.isArray(payload.alerts?.alerts) ? payload.alerts.alerts : [];

  if (alerts.length === 0) {
    console.log("No open finance alerts found. Seeding baseline finance alignment smoke...");
    execFileSync("node", ["scripts/smokeFinanceAlignment.js"], {
      stdio: "inherit",
      cwd: process.cwd(),
      env: { ...process.env, SMOKE_BASE_URL: baseUrl, ADMIN_KEY: adminKey },
    });

    await runJobs(weekKey, dayKey);
    payload = await fetchDigestAndAlerts(weekKey, dayKey);
    alerts = Array.isArray(payload.alerts?.alerts) ? payload.alerts.alerts : [];
  }

  let ackResult = null;
  let resolveResult = null;
  if (alerts.length > 0) {
    const alertId = String(alerts[0].id || "");
    const ack = await requestJson(`/api/admin/finance/alerts/ack?key=${encodeURIComponent(adminKey)}`, {
      method: "POST",
      body: {
        alertId,
        by: "smoke",
        note: "ack from smoke",
        confirm: "ACK",
      },
    });
    assert(ack.response.ok, "Finance alert ack failed.");
    assert(Boolean(ack.json?.ok), "Finance alert ack response not ok.");
    assert(String(ack.json?.alert?.status || "") === "acknowledged", "Finance alert not acknowledged.");
    ackResult = ack.json?.alert || null;

    const resolve = await requestJson(
      `/api/admin/finance/alerts/resolve?key=${encodeURIComponent(adminKey)}`,
      {
        method: "POST",
        body: {
          alertId,
          by: "smoke",
          note: "resolve from smoke",
          confirm: "RESOLVE",
        },
      }
    );
    assert(resolve.response.ok, "Finance alert resolve failed.");
    assert(Boolean(resolve.json?.ok), "Finance alert resolve response not ok.");
    assert(String(resolve.json?.alert?.status || "") === "resolved", "Finance alert not resolved.");
    resolveResult = resolve.json?.alert || null;
  }

  console.log("Finance alerts smoke passed.");
  console.log(
    JSON.stringify(
      {
        weekKey,
        dayKey,
        messageLength: String(payload.digest?.messageEs || "").length,
        openAlerts: alerts.length,
        eventsInserted: Number(firstRun.anomalies?.eventsInserted || 0),
        alertsUpserted: Number(firstRun.alertsJob?.alertsUpserted || 0),
        acked: ackResult ? String(ackResult.id || "") : "skipped-no-alert",
        resolved: resolveResult ? String(resolveResult.id || "") : "skipped-no-alert",
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error("Finance alerts smoke failed:", error instanceof Error ? error.message : String(error));
  process.exit(1);
});
