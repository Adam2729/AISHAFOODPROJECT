import AsyncStorage from "@react-native-async-storage/async-storage";
import { normalizePreferredLanguage } from "./marketConfig";

export const CITY_STORAGE_KEY = "aisha_selected_city_v1";
export const LANGUAGE_STORAGE_KEY = "aisha_preferred_language_v1";

let cacheLoaded = false;
let cachedCity = null;
let languageCacheLoaded = false;
let cachedPreferredLanguage = "";

function normalizeCity(input) {
  if (!input || typeof input !== "object") return null;
  const _id = String(input._id || "").trim();
  const name = String(input.name || "").trim();
  const country = String(input.country || "").trim();
  const currency = String(input.currency || "").trim();
  if (!_id || !name) return null;
  return {
    _id,
    code: String(input.code || "").trim(),
    slug: String(input.slug || "").trim(),
    name,
    country,
    currency,
    currencyCode: String(input.currencyCode || input.currency || "").trim(),
    currencyDisplay: String(input.currencyDisplay || "").trim(),
    marketCode: String(input.marketCode || "").trim(),
    defaultLanguage: String(input.defaultLanguage || "").trim(),
    allowedLanguages: Array.isArray(input.allowedLanguages) ? input.allowedLanguages : [],
    supportWhatsApp: String(input.supportWhatsApp || "").trim(),
    defaultTimezone: String(input.defaultTimezone || "").trim(),
    paymentMethods: Array.isArray(input.paymentMethods) ? input.paymentMethods : [],
  };
}

async function ensureLoaded() {
  if (cacheLoaded) return;
  cacheLoaded = true;
  try {
    const raw = await AsyncStorage.getItem(CITY_STORAGE_KEY);
    if (!raw) {
      cachedCity = null;
      return;
    }
    cachedCity = normalizeCity(JSON.parse(raw));
  } catch {
    cachedCity = null;
  }
}

async function ensureLanguageLoaded() {
  if (languageCacheLoaded) return;
  languageCacheLoaded = true;
  try {
    cachedPreferredLanguage = String(
      (await AsyncStorage.getItem(LANGUAGE_STORAGE_KEY)) || ""
    )
      .trim()
      .toLowerCase();
  } catch {
    cachedPreferredLanguage = "";
  }
}

function applyLanguageOverride(city) {
  if (!city) return null;
  const override = String(cachedPreferredLanguage || "").trim().toLowerCase();
  if (!override) return city;
  return {
    ...city,
    defaultLanguage: normalizePreferredLanguage(override, city),
  };
}

export async function getSelectedCity() {
  await ensureLoaded();
  await ensureLanguageLoaded();
  return applyLanguageOverride(cachedCity);
}

export async function getSelectedCityId() {
  const city = await getSelectedCity();
  return String(city?._id || "").trim();
}

export async function setSelectedCity(city) {
  const normalized = normalizeCity(city);
  if (!normalized) return null;
  cachedCity = normalized;
  cacheLoaded = true;
  await AsyncStorage.setItem(CITY_STORAGE_KEY, JSON.stringify(normalized));
  await ensureLanguageLoaded();
  return applyLanguageOverride(normalized);
}

export async function clearSelectedCity() {
  cachedCity = null;
  cacheLoaded = true;
  await AsyncStorage.removeItem(CITY_STORAGE_KEY);
}

export async function getPreferredAppLanguage() {
  await ensureLanguageLoaded();
  return cachedPreferredLanguage;
}

export async function setPreferredAppLanguage(language, cityOrMarket) {
  const normalized = normalizePreferredLanguage(language, cityOrMarket);
  cachedPreferredLanguage = normalized;
  languageCacheLoaded = true;
  await AsyncStorage.setItem(LANGUAGE_STORAGE_KEY, normalized);
  return normalized;
}

export async function clearPreferredAppLanguage() {
  cachedPreferredLanguage = "";
  languageCacheLoaded = true;
  await AsyncStorage.removeItem(LANGUAGE_STORAGE_KEY);
}
