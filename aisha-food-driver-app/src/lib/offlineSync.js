import * as SecureStore from "expo-secure-store";

const PENDING_DRIVER_ACTIONS_KEY = "aisha_food_driver_pending_actions";

let cachedActions = [];
let hasHydratedCache = false;
const actionListeners = new Set();

function randomKey() {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

function normalizePayload(payload) {
  return payload && typeof payload === "object" ? payload : {};
}

function buildFingerprint(orderId, action, payload) {
  return `${orderId}:${action}:${JSON.stringify(payload)}`;
}

function normalizePendingAction(input) {
  const orderId = String(input?.orderId || "").trim();
  const action = String(input?.action || "").trim().toLowerCase();
  if (!orderId || !action) return null;

  const payload = normalizePayload(input?.payload);
  const createdAt = String(input?.createdAt || new Date().toISOString()).trim();
  const updatedAt = String(input?.updatedAt || new Date().toISOString()).trim();
  const fingerprint =
    String(input?.fingerprint || "").trim() || buildFingerprint(orderId, action, payload);

  return {
    syncId: String(input?.syncId || `sync_${randomKey()}`).trim(),
    orderId,
    action,
    payload,
    fingerprint,
    createdAt,
    updatedAt,
  };
}

async function readStoredActions() {
  try {
    return await SecureStore.getItemAsync(PENDING_DRIVER_ACTIONS_KEY);
  } catch {
    return null;
  }
}

function notifyListeners() {
  for (const listener of actionListeners) {
    try {
      listener(cachedActions);
    } catch {
      // Listener errors should not interrupt sync persistence.
    }
  }
}

async function persistActions(actions) {
  cachedActions = actions;
  hasHydratedCache = true;

  try {
    if (!actions.length) {
      await SecureStore.deleteItemAsync(PENDING_DRIVER_ACTIONS_KEY);
    } else {
      await SecureStore.setItemAsync(PENDING_DRIVER_ACTIONS_KEY, JSON.stringify(actions));
    }
  } catch {
    notifyListeners();
    return actions;
  }

  notifyListeners();
  return actions;
}

export async function getPendingDriverActions() {
  if (hasHydratedCache) {
    return cachedActions;
  }

  const raw = await readStoredActions();
  if (!raw) {
    cachedActions = [];
    hasHydratedCache = true;
    return cachedActions;
  }

  try {
    const parsed = JSON.parse(raw);
    cachedActions = (Array.isArray(parsed) ? parsed : [])
      .map(normalizePendingAction)
      .filter(Boolean);
  } catch {
    cachedActions = [];
  }

  hasHydratedCache = true;
  return cachedActions;
}

export function subscribePendingDriverActions(listener) {
  if (typeof listener !== "function") {
    return () => {};
  }

  actionListeners.add(listener);
  return () => {
    actionListeners.delete(listener);
  };
}

export async function queuePendingDriverAction(input) {
  const normalized = normalizePendingAction(input);
  if (!normalized) {
    return null;
  }

  const existing = await getPendingDriverActions();
  const withoutMatch = existing.filter((item) => item.fingerprint !== normalized.fingerprint);
  const nextActions = [...withoutMatch, normalized];
  await persistActions(nextActions);
  return normalized;
}

export async function removePendingDriverActions(syncIds = []) {
  const ids = new Set(
    (Array.isArray(syncIds) ? syncIds : [syncIds])
      .map((value) => String(value || "").trim())
      .filter(Boolean)
  );
  if (!ids.size) {
    return getPendingDriverActions();
  }

  const existing = await getPendingDriverActions();
  const nextActions = existing.filter((item) => !ids.has(String(item.syncId || "").trim()));
  await persistActions(nextActions);
  return nextActions;
}

export async function clearPendingDriverActions() {
  await persistActions([]);
  return [];
}

export function isRetryableDriverActionError(error) {
  const code = String(error?.code || "").trim().toUpperCase();
  if (!error?.status) {
    return true;
  }
  return code === "NETWORK_ERROR" || code === "TIMEOUT_ERROR";
}

export function shouldDropPendingSyncResult(result) {
  if (result?.ok || result?.idempotent) {
    return true;
  }

  const code = String(result?.error?.code || "").trim().toUpperCase();
  if (!code) {
    return false;
  }

  return code !== "SERVER_ERROR";
}
