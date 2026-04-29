import AsyncStorage from "@react-native-async-storage/async-storage";
import { apiGet, apiPatch, apiPost } from "./api";

const SESSION_STORAGE_KEY = "aisha_user_session";

function normalizePhoneDigits(value) {
  return String(value || "").replace(/\D+/g, "").trim();
}

function normalizeSessionRecord(raw) {
  if (!raw || typeof raw !== "object") return null;
  const token = String(raw.sessionToken || "").trim();
  const phone = normalizePhoneDigits(raw.phone || "");
  const expiresAt = String(raw.expiresAt || "").trim();
  if (!token || !phone || !expiresAt) return null;
  const expiresMs = new Date(expiresAt).getTime();
  if (!Number.isFinite(expiresMs)) return null;
  return { sessionToken: token, phone, expiresAt };
}

async function getStoredSession() {
  try {
    const raw = await AsyncStorage.getItem(SESSION_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return normalizeSessionRecord(parsed);
  } catch {
    return null;
  }
}

async function setStoredSession(session) {
  await AsyncStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
}

export async function ensureUserSession(phoneRaw) {
  const phone = normalizePhoneDigits(phoneRaw);
  if (!phone) {
    const error = new Error("Telefono requerido.");
    error.code = "VALIDATION_ERROR";
    throw error;
  }

  const existing = await getStoredSession();
  if (existing && existing.phone === phone) {
    const expiresMs = new Date(existing.expiresAt).getTime();
    if (Number.isFinite(expiresMs) && expiresMs > Date.now() + 60 * 1000) {
      return existing.sessionToken;
    }
  }

  const response = await apiPost("/api/public/user/session", { phone });
  const sessionToken = String(response?.sessionToken || "").trim();
  const expiresAt = String(response?.expiresAt || "").trim();
  if (!sessionToken || !expiresAt) {
    const error = new Error("No se pudo crear sesion.");
    error.code = "SESSION_ERROR";
    throw error;
  }

  await setStoredSession({ sessionToken, expiresAt, phone });
  return sessionToken;
}

export async function getUserProfile(phoneRaw) {
  const sessionToken = await ensureUserSession(phoneRaw);
  const response = await apiGet("/api/user/profile", {
    headers: { "x-user-session": sessionToken },
  });
  return response?.profile || null;
}

export async function updateUserProfile(phoneRaw, payload) {
  const sessionToken = await ensureUserSession(phoneRaw);
  const response = await apiPatch("/api/user/profile", payload, {
    headers: { "x-user-session": sessionToken },
  });
  return response?.profile || null;
}
