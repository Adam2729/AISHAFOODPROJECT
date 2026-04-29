const fs = require("node:fs");
const path = require("node:path");

const EXPECTED_ANDROID_PACKAGE = "com.aishafood.app";
const REQUEST_TIMEOUT_MS = 8000;

function normalizeApiUrl(rawValue) {
  const trimmed = String(rawValue || "")
    .trim()
    .replace(/^['"]|['"]$/g, "");
  if (!trimmed) return "";
  return trimmed.replace(/^(https?):\/(?!\/)/i, "$1://").replace(/\/+$/, "");
}

function hasSingleSlashSchemeTypo(rawValue) {
  return /^(https?):\/(?!\/)/i.test(String(rawValue || "").trim());
}

function parseEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const raw = fs.readFileSync(filePath, "utf8");
  const out = {};
  raw.split(/\r?\n/).forEach((line) => {
    const trimmed = String(line || "").trim();
    if (!trimmed || trimmed.startsWith("#")) return;
    const idx = trimmed.indexOf("=");
    if (idx < 0) return;
    const key = trimmed.slice(0, idx).trim();
    const value = trimmed.slice(idx + 1).trim();
    out[key] = value.replace(/^['"]|['"]$/g, "");
  });
  return out;
}

function readEnv() {
  const cwd = process.cwd();
  return {
    ...parseEnvFile(path.join(cwd, ".env")),
    ...parseEnvFile(path.join(cwd, ".env.local")),
    ...process.env,
  };
}

function isLocalLikeHost(hostname) {
  const host = String(hostname || "").trim().toLowerCase();
  if (!host) return true;
  if (host === "localhost" || host === "127.0.0.1" || host === "::1") return true;
  if (/^10\./.test(host)) return true;
  if (/^192\.168\./.test(host)) return true;
  if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(host)) return true;
  return false;
}

function normalizeLaunchEnv(rawValue) {
  const value = String(rawValue || "")
    .trim()
    .toLowerCase();
  if (value === "local" || value === "preview" || value === "production") {
    return value;
  }
  return "";
}

function hostLooksPreview(hostname) {
  return /(preview|staging|qa|sandbox|test|dev)/i.test(String(hostname || ""));
}

function inferTargetMode(parsedUrl, explicitMode) {
  if (explicitMode) return explicitMode;
  if (!parsedUrl) return "unknown";
  if (isLocalLikeHost(parsedUrl.hostname)) return "local";
  if (hostLooksPreview(parsedUrl.hostname)) return "preview";
  return "production";
}

function normalizeDigits(rawValue) {
  return String(rawValue || "")
    .trim()
    .replace(/^['"]|['"]$/g, "")
    .replace(/\D+/g, "");
}

function supportConfigured(value) {
  const digits = normalizeDigits(value);
  return digits.length >= 7 && digits !== "18090000000" && digits !== "22300000000";
}

async function fetchJson(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
    const json = await response.json().catch(() => null);
    return { response, json };
  } finally {
    clearTimeout(timer);
  }
}

function printCheck(label, ok, detail) {
  const prefix = ok ? "[PASS]" : "[FAIL]";
  console.log(`${prefix} ${label}${detail ? `: ${detail}` : ""}`);
}

async function main() {
  const env = readEnv();
  const rawApiUrl = String(env.EXPO_PUBLIC_API_URL || env.API_BASE_URL || "").trim();
  const apiUrl = normalizeApiUrl(rawApiUrl);
  const launchEnv = normalizeLaunchEnv(env.EXPO_PUBLIC_LAUNCH_ENV);
  const failures = [];
  const warnings = [];
  const appJsonPath = path.join(process.cwd(), "app.json");
  let parsedUrl = null;
  let androidPackage = "";
  let backendCities = [];

  printCheck("Launch env configured", Boolean(launchEnv), launchEnv || "missing");
  if (!launchEnv) {
    failures.push("Set EXPO_PUBLIC_LAUNCH_ENV to local, preview, or production.");
  }

  if (!apiUrl) {
    failures.push("Missing EXPO_PUBLIC_API_URL or API_BASE_URL.");
    printCheck("API URL configured", false, "not set");
  } else {
    printCheck("API URL configured", true, apiUrl);
  }

  if (rawApiUrl) {
    const slashFormatOk = !hasSingleSlashSchemeTypo(rawApiUrl);
    printCheck("API URL slash format", slashFormatOk, rawApiUrl);
    if (!slashFormatOk) {
      failures.push(`API URL must use a full scheme. Current value: ${rawApiUrl}`);
    }
  }

  if (apiUrl) {
    try {
      parsedUrl = new URL(apiUrl);
      printCheck("API URL format", true, parsedUrl.toString());
    } catch {
      failures.push("API URL is not a valid absolute URL.");
      printCheck("API URL format", false, apiUrl);
    }
  }

  const inferredTarget = inferTargetMode(parsedUrl, launchEnv);
  printCheck("API target mode", inferredTarget !== "unknown", inferredTarget);

  if (parsedUrl) {
    const httpsRequired = inferredTarget === "preview" || inferredTarget === "production";
    const httpsOk = !httpsRequired || parsedUrl.protocol === "https:";
    printCheck("API URL protocol", httpsOk, parsedUrl.protocol);
    if (!httpsOk) {
      failures.push(`${inferredTarget} builds must use HTTPS.`);
    }

    const hostIsLocal = isLocalLikeHost(parsedUrl.hostname);
    const hostOk = inferredTarget === "local" ? true : !hostIsLocal;
    printCheck("API host scope", hostOk, parsedUrl.hostname);
    if (!hostOk) {
      failures.push(`${inferredTarget} builds must use a public backend host, not localhost/LAN.`);
    }
  }

  if (!fs.existsSync(appJsonPath)) {
    failures.push("Missing app.json.");
    printCheck("Android package id", false, "app.json not found");
  } else {
    try {
      const appJson = JSON.parse(fs.readFileSync(appJsonPath, "utf8"));
      androidPackage = String(appJson?.expo?.android?.package || "").trim();
      const packageMatches = androidPackage === EXPECTED_ANDROID_PACKAGE;
      printCheck("Android package id", packageMatches, androidPackage || "not set");
      if (!packageMatches) {
        failures.push(
          `Android package id must stay ${EXPECTED_ANDROID_PACKAGE}. Current value: ${androidPackage || "not set"}.`
        );
      }
    } catch {
      failures.push("app.json is not valid JSON.");
      printCheck("Android package id", false, "app.json unreadable");
    }
  }

  if (parsedUrl) {
    const endpoints = ["/api/status", "/api/public/cities"];
    for (const endpoint of endpoints) {
      try {
        const { response, json } = await fetchJson(`${apiUrl}${endpoint}`);
        const ok = Boolean(response.ok && json);
        printCheck(`Reachability ${endpoint}`, ok, `${response.status}`);
        if (!ok) {
          failures.push(`Could not verify ${endpoint} on ${apiUrl}.`);
        } else if (endpoint === "/api/public/cities") {
          backendCities = Array.isArray(json?.cities) ? json.cities : [];
        }
      } catch (error) {
        printCheck(`Reachability ${endpoint}`, false, error instanceof Error ? error.message : "request failed");
        failures.push(`Could not reach ${endpoint} on ${apiUrl}.`);
      }
    }
  }

  const configuredSupportNumbers = [
    env.EXPO_PUBLIC_SUPPORT_WHATSAPP_NUMBER,
    env.EXPO_PUBLIC_SUPPORT_WHATSAPP_NUMBER_ML,
    env.EXPO_PUBLIC_SUPPORT_WHATSAPP_NUMBER_DO,
  ].filter((value) => supportConfigured(value));
  const backendSupportConfigured = backendCities.some(
    (city) => supportConfigured(city?.supportWhatsApp || city?.supportWhatsAppE164)
  );
  const supportReady = configuredSupportNumbers.length > 0 || backendSupportConfigured;
  const supportCheckOk = launchEnv === "production" ? supportReady : true;
  const supportDetail = supportReady
    ? configuredSupportNumbers[0] || "provided by backend city config"
    : launchEnv === "production"
      ? "missing - required before production launch"
      : launchEnv === "preview"
        ? "missing - preview warning only"
        : "missing - allowed for local UK testing";
  printCheck("Support WhatsApp readiness", supportCheckOk, supportDetail);
  if (!supportCheckOk) {
    failures.push("Support WhatsApp is required for production launch.");
  } else if (!supportReady) {
    warnings.push(
      launchEnv === "preview"
        ? "Support WhatsApp is still missing. Preview testing can continue, but production is not launch-ready."
        : "Support WhatsApp is still missing. Local UK testing can continue, but production is not launch-ready."
    );
  }

  if (failures.length) {
    console.error("\nMobile launch environment validation failed.");
    failures.forEach((failure) => console.error(`- ${failure}`));
    process.exit(1);
  }

  if (warnings.length) {
    console.log("\nWarnings:");
    warnings.forEach((warning) => console.log(`- ${warning}`));
  }

  console.log("\nMobile launch environment validation passed.");
}

main().catch((error) => {
  console.error(
    "Mobile launch environment validation failed:",
    error instanceof Error ? error.message : String(error)
  );
  process.exit(1);
});
