import AsyncStorage from "@react-native-async-storage/async-storage";

const TOKEN_KEY = "merchant_token";
const PROFILE_KEY = "merchant_profile";

export async function saveToken(token) {
  const value = String(token || "").trim();
  if (!value) {
    await AsyncStorage.removeItem(TOKEN_KEY);
    return;
  }
  await AsyncStorage.setItem(TOKEN_KEY, value);
}

export async function getToken() {
  const token = await AsyncStorage.getItem(TOKEN_KEY);
  return String(token || "").trim();
}

export async function clearToken() {
  await AsyncStorage.removeItem(TOKEN_KEY);
}

export async function saveMerchant(merchant) {
  if (!merchant || typeof merchant !== "object") {
    await AsyncStorage.removeItem(PROFILE_KEY);
    return;
  }
  await AsyncStorage.setItem(PROFILE_KEY, JSON.stringify(merchant));
}

export async function getMerchant() {
  const raw = await AsyncStorage.getItem(PROFILE_KEY);
  if (!raw) return null;

  try {
    return JSON.parse(raw);
  } catch {
    await AsyncStorage.removeItem(PROFILE_KEY);
    return null;
  }
}

export async function clearSession() {
  await AsyncStorage.multiRemove([TOKEN_KEY, PROFILE_KEY]);
}
