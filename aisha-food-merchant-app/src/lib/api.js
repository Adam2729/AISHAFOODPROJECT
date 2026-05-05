const rawApiUrl = String(process.env.EXPO_PUBLIC_API_URL || "").trim();

export const API_URL = rawApiUrl.replace(/\/+$/, "");

function createApiError(message, extra = {}) {
  const error = new Error(message);
  Object.assign(error, extra);
  return error;
}

export function getApiUrl() {
  if (!API_URL) {
    throw createApiError("Missing EXPO_PUBLIC_API_URL. Set the merchant app env first.", {
      code: "MISSING_API_URL",
      status: 0,
    });
  }
  return API_URL;
}

async function parseJsonSafely(response) {
  const text = await response.text();
  if (!text) return { json: null, rawText: "" };

  try {
    return { json: JSON.parse(text), rawText: text };
  } catch {
    return { json: null, rawText: text };
  }
}

export async function apiRequest(path, method = "GET", body, token) {
  const normalizedPath = String(path || "").startsWith("/") ? path : `/${String(path || "")}`;
  const url = `${getApiUrl()}${normalizedPath}`;

  let response;
  try {
    response = await fetch(url, {
      method,
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw createApiError(
      "Cannot connect to OranjeEats server. Check EXPO_PUBLIC_API_URL and backend.",
      {
        code: "NETWORK_ERROR",
        status: 0,
      }
    );
  }

  const { json, rawText } = await parseJsonSafely(response);
  const hasJson = Boolean(json && typeof json === "object");
  const failed = !response.ok || json?.ok === false;

  if (!hasJson && rawText) {
    const contentType = String(response.headers.get("content-type") || "").toLowerCase();
    if (contentType.includes("text/html") || rawText.trim().startsWith("<")) {
      throw createApiError("OranjeEats server returned an unexpected response.", {
        code: "INVALID_RESPONSE",
        status: response.status,
        payload: rawText.slice(0, 200),
      });
    }
  }

  if (failed) {
    const message =
      json?.error?.message ||
      json?.message ||
      (response.status === 401
        ? "Your session expired. Please sign in again."
        : "Request failed. Please try again.");
    throw createApiError(message, {
      code: json?.error?.code || json?.code || "REQUEST_FAILED",
      status: response.status,
      payload: json || rawText || null,
    });
  }

  if (!hasJson) {
    throw createApiError("OranjeEats server returned an unexpected response.", {
      code: "INVALID_RESPONSE",
      status: response.status,
      payload: rawText.slice(0, 200),
    });
  }

  return json;
}
