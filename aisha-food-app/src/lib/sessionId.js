import AsyncStorage from "@react-native-async-storage/async-storage";

const SESSION_KEY = "aisha_funnel_session_id_v1";

function generateSessionId() {
  const randomPart = Math.random().toString(36).slice(2, 12);
  const timePart = Date.now().toString(36);
  return `${timePart}_${randomPart}`;
}

export async function getOrCreateSessionId() {
  try {
    const existing = await AsyncStorage.getItem(SESSION_KEY);
    const normalized = String(existing || "").trim();
    if (normalized) return normalized;
    const next = generateSessionId();
    await AsyncStorage.setItem(SESSION_KEY, next);
    return next;
  } catch {
    return generateSessionId();
  }
}

