export const API_BASE_URL = String(process.env.EXPO_PUBLIC_API_BASE_URL || "")
  .trim()
  .replace(/\/+$/, "");

export const API_CONFIG_ERROR =
  "Set EXPO_PUBLIC_API_BASE_URL to the AishaFood backend base URL before making driver API requests.";

export function getRequiredApiBaseUrl() {
  if (!API_BASE_URL) {
    const error = new Error(API_CONFIG_ERROR);
    error.code = "CONFIG_ERROR";
    throw error;
  }

  return API_BASE_URL;
}

export function buildApiUrl(path) {
  const safePath = String(path || "").trim();
  if (!safePath) return getRequiredApiBaseUrl();
  return `${getRequiredApiBaseUrl()}${safePath.startsWith("/") ? safePath : `/${safePath}`}`;
}
