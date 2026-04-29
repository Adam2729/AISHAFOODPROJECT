import * as SecureStore from "expo-secure-store";

const AUTH_SESSION_KEY = "aisha_food_driver_session";

let cachedSession = null;
let hasHydratedCache = false;
const sessionListeners = new Set();

function normalizeSession(session) {
  if (!session || typeof session !== "object") return null;

  const accessToken = String(session.accessToken || "").trim();
  const refreshToken = String(session.refreshToken || "").trim();

  if (!accessToken) return null;

  return {
    accessToken,
    refreshToken: refreshToken || null,
    driver: session.driver && typeof session.driver === "object" ? session.driver : null,
  };
}

async function readSecureValue() {
  try {
    return await SecureStore.getItemAsync(AUTH_SESSION_KEY);
  } catch {
    return null;
  }
}

function notifySessionListeners() {
  for (const listener of sessionListeners) {
    try {
      listener(cachedSession);
    } catch {
      // Listener failures should not break secure storage writes.
    }
  }
}

export function subscribeAuthSession(listener) {
  if (typeof listener !== "function") {
    return () => {};
  }

  sessionListeners.add(listener);
  return () => {
    sessionListeners.delete(listener);
  };
}

export async function getAuthSession() {
  if (hasHydratedCache) {
    return cachedSession;
  }

  const raw = await readSecureValue();
  if (!raw) {
    hasHydratedCache = true;
    cachedSession = null;
    return null;
  }

  try {
    cachedSession = normalizeSession(JSON.parse(raw));
  } catch {
    cachedSession = null;
  }

  hasHydratedCache = true;
  return cachedSession;
}

export async function getAccessToken() {
  const session = await getAuthSession();
  return String(session?.accessToken || "").trim();
}

export async function saveAuthSession(session) {
  const normalized = normalizeSession(session);
  cachedSession = normalized;
  hasHydratedCache = true;

  if (!normalized) {
    try {
      await SecureStore.deleteItemAsync(AUTH_SESSION_KEY);
    } catch {
      notifySessionListeners();
      return null;
    }
    notifySessionListeners();
    return null;
  }

  try {
    await SecureStore.setItemAsync(AUTH_SESSION_KEY, JSON.stringify(normalized));
  } catch {
    notifySessionListeners();
    return normalized;
  }

  notifySessionListeners();
  return normalized;
}

export async function clearAuthSession() {
  cachedSession = null;
  hasHydratedCache = true;
  try {
    await SecureStore.deleteItemAsync(AUTH_SESSION_KEY);
  } catch {
    notifySessionListeners();
    return;
  }
  notifySessionListeners();
}
