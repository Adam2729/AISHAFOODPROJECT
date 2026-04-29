function normalizeApiBaseUrl(rawValue) {
  const trimmed = String(rawValue || "")
    .trim()
    .replace(/^['"]|['"]$/g, "");
  if (!trimmed) return "";

  // Recover from common env typos like `https:/api.aishafood.com`.
  const repairedScheme = trimmed.replace(/^(https?):\/(?!\/)/i, "$1://");
  return repairedScheme.replace(/\/+$/, "");
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

function isLocalLikeHost(hostname) {
  const host = String(hostname || "").trim().toLowerCase();
  if (!host) return true;
  if (host === "localhost" || host === "127.0.0.1" || host === "::1") return true;
  if (/^10\./.test(host)) return true;
  if (/^192\.168\./.test(host)) return true;
  if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(host)) return true;
  return false;
}

function hostLooksPreview(hostname) {
  return /(preview|staging|qa|sandbox|test|dev)/i.test(String(hostname || ""));
}

function parseBaseUrl(value) {
  try {
    return value ? new URL(value) : null;
  } catch {
    return null;
  }
}

function buildApiTargetProfile(baseUrl, explicitLaunchEnv) {
  const parsedUrl = parseBaseUrl(baseUrl);
  const hostname = parsedUrl?.hostname || "";
  const protocol = parsedUrl?.protocol || "";
  const isLocal = Boolean(parsedUrl && isLocalLikeHost(hostname));

  let environment = explicitLaunchEnv || "local";
  if (!explicitLaunchEnv && parsedUrl) {
    if (isLocal) {
      environment = "local";
    } else if (hostLooksPreview(hostname)) {
      environment = "preview";
    } else {
      environment = "production";
    }
  }

  const label =
    environment === "production"
      ? "production"
      : environment === "preview"
      ? "preview"
      : "local";

  return {
    baseUrl,
    parsedUrl,
    environment,
    label,
    hostname,
    protocol,
    isConfigured: Boolean(baseUrl),
    isLocal,
    isPreview: environment === "preview",
    isProduction: environment === "production",
    isHttps: protocol === "https:",
    isValidUrl: Boolean(parsedUrl),
  };
}

const fromExpoPublic = String(process.env.EXPO_PUBLIC_API_URL || "").trim();
const fromLegacy = String(process.env.API_BASE_URL || "").trim();
const explicitLaunchEnv = normalizeLaunchEnv(process.env.EXPO_PUBLIC_LAUNCH_ENV);
const rawResolved = fromExpoPublic || fromLegacy;
const resolved = normalizeApiBaseUrl(rawResolved);
const apiTargetProfile = buildApiTargetProfile(resolved, explicitLaunchEnv);

const configErrors = [];
if (!resolved) {
  configErrors.push(
    "Missing API base URL. Set EXPO_PUBLIC_API_URL in aisha-food-app/.env for local dev, or in the EAS build environment for preview/production."
  );
}
if (resolved && !apiTargetProfile.isValidUrl) {
  configErrors.push(`Invalid API base URL: ${resolved}`);
}
if (!explicitLaunchEnv) {
  configErrors.push(
    "Missing EXPO_PUBLIC_LAUNCH_ENV. Set it to local, preview, or production so the app can validate the configured backend correctly."
  );
}
if (
  apiTargetProfile.isConfigured &&
  apiTargetProfile.isValidUrl &&
  (apiTargetProfile.isPreview || apiTargetProfile.isProduction) &&
  (!apiTargetProfile.isHttps || apiTargetProfile.isLocal)
) {
  configErrors.push(
    `The configured ${apiTargetProfile.label} backend must use a reachable public HTTPS host. Current value: ${resolved}`
  );
}

export const API_CONFIG_ERROR = configErrors[0] || "";
export const API_BASE_URL = resolved;
export const API_TARGET_PROFILE = apiTargetProfile;
export const API_TARGET_LABEL = apiTargetProfile.label;

if (API_CONFIG_ERROR && typeof __DEV__ !== "undefined" && __DEV__) {
  console.error(API_CONFIG_ERROR);
}

if (
  rawResolved &&
  resolved !== rawResolved &&
  typeof __DEV__ !== "undefined" &&
  __DEV__
) {
  console.warn(`Normalized API base URL from "${rawResolved}" to "${resolved}".`);
}

export function describeApiTarget(profile = API_TARGET_PROFILE) {
  if (!profile?.baseUrl) return "unconfigured backend";
  if (profile.isProduction) return `production backend (${profile.baseUrl})`;
  if (profile.isPreview) return `preview backend (${profile.baseUrl})`;
  return `local backend (${profile.baseUrl})`;
}

export function buildApiReachabilityErrorMessage(url = API_BASE_URL) {
  if (API_CONFIG_ERROR) return API_CONFIG_ERROR;
  if (API_TARGET_PROFILE.isProduction) {
    return `Cannot reach the configured production backend (${url}). Verify EXPO_PUBLIC_API_URL, the live deployment, and DNS/SSL before launch.`;
  }
  if (API_TARGET_PROFILE.isPreview) {
    return `Cannot reach the configured preview backend (${url}). Verify the preview deployment and EAS environment config.`;
  }
  return `Cannot reach the configured local backend (${url}). Start the backend or expose it with a tunnel, then confirm the device can reach that host.`;
}

export function getRequiredApiBaseUrl() {
  if (API_BASE_URL && !API_CONFIG_ERROR) return API_BASE_URL;
  throw new Error(
    API_CONFIG_ERROR ||
      "Missing API base URL. Set EXPO_PUBLIC_API_URL before starting the app."
  );
}
