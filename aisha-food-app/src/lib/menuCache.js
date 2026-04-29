import AsyncStorage from "@react-native-async-storage/async-storage";

export const MENU_CACHE_KEY = "menu_cache_v1";
export const MENU_CACHE_TTL_MS = 600000;

export async function loadCachedMenu() {
  try {
    const raw = await AsyncStorage.getItem(MENU_CACHE_KEY);
    if (!raw) return null;

    const parsed = JSON.parse(raw);
    const cachedAt = Number(parsed?.cachedAt);
    if (!Number.isFinite(cachedAt)) return null;

    const expired = Date.now() - cachedAt > MENU_CACHE_TTL_MS;
    if (expired) return null;

    return parsed?.payload ?? null;
  } catch {
    return null;
  }
}

export async function saveCachedMenu(payload) {
  try {
    const value = {
      cachedAt: Date.now(),
      payload,
    };
    await AsyncStorage.setItem(MENU_CACHE_KEY, JSON.stringify(value));
  } catch {
    // Fail-safe: never throw from cache writes.
  }
}

export async function clearMenuCache() {
  try {
    await AsyncStorage.removeItem(MENU_CACHE_KEY);
  } catch {
    // Fail-safe: never throw from cache clear.
  }
}
