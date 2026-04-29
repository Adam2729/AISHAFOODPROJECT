import {
  API_CONFIG_ERROR,
  API_BASE_URL,
  buildApiReachabilityErrorMessage,
  getRequiredApiBaseUrl,
} from "./config";
import { getSelectedCityId } from "./citySelection";

const REQUEST_TIMEOUT_MS = 12000;

function createAppError(message, code, status) {
  const err = new Error(String(message || "Request failed"));
  err.code = code || "REQUEST_ERROR";
  if (typeof status === "number") err.status = status;
  return err;
}

async function parseError(res, fallback) {
  const data = await res.json().catch(() => ({}));
  const message =
    data?.error?.message ||
    data?.error ||
    data?.message ||
    fallback;
  return createAppError(String(message), data?.error?.code || "API_ERROR", res.status);
}

async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (e) {
    if (e?.name === "AbortError") {
      throw createAppError("Conexion lenta o sin respuesta. Intenta de nuevo.", "TIMEOUT_ERROR");
    }
    throw createAppError(buildApiReachabilityErrorMessage(url), "NETWORK_ERROR");
  } finally {
    clearTimeout(timer);
  }
}

function normalizeHeaders(input) {
  if (!input) return {};
  if (input instanceof Headers) return Object.fromEntries(input.entries());
  if (Array.isArray(input)) return Object.fromEntries(input);
  return { ...input };
}

async function withCityHeader(inputHeaders) {
  const headers = normalizeHeaders(inputHeaders);
  const headerKeys = Object.keys(headers).map((key) => String(key || "").toLowerCase());
  const hasXCity = headerKeys.includes("x-city");
  const hasXCityId = headerKeys.includes("x-city-id");
  const cityId = String((await getSelectedCityId()) || "").trim();

  if (cityId) {
    if (!hasXCity) headers["x-city"] = cityId;
    if (!hasXCityId) headers["x-city-id"] = cityId;
  }
  return headers;
}

function getRequestUrl(path) {
  const baseUrl = getRequiredApiBaseUrl();
  return `${baseUrl}${path}`;
}

export async function apiGet(path, options = {}) {
  if (!API_BASE_URL) {
    throw createAppError(API_CONFIG_ERROR, "CONFIG_ERROR");
  }
  const url = getRequestUrl(path);
  const headers = await withCityHeader(options.headers);
  const res = await fetchWithTimeout(url, {
    headers,
  });
  if (!res.ok) {
    throw await parseError(res, `GET ${path} failed (${res.status})`);
  }
  return res.json();
}

export async function apiPost(path, body, options = {}) {
  if (!API_BASE_URL) {
    throw createAppError(API_CONFIG_ERROR, "CONFIG_ERROR");
  }
  const url = getRequestUrl(path);
  const headers = await withCityHeader(options.headers);
  const res = await fetchWithTimeout(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw await parseError(res, `POST ${path} failed (${res.status})`);
  }
  return res.json();
}

export async function apiPatch(path, body, options = {}) {
  if (!API_BASE_URL) {
    throw createAppError(API_CONFIG_ERROR, "CONFIG_ERROR");
  }
  const url = getRequestUrl(path);
  const headers = await withCityHeader(options.headers);
  const res = await fetchWithTimeout(url, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw await parseError(res, `PATCH ${path} failed (${res.status})`);
  }
  return res.json();
}
