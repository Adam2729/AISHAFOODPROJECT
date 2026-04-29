import { apiGet } from "./api";
import {
  API_BASE_URL,
  API_CONFIG_ERROR,
  API_TARGET_PROFILE,
  describeApiTarget,
} from "./config";
import { getSelectedCity } from "./citySelection";
import { getMarketConfig } from "./marketConfig";

function buildCheck(id, label, ok, detail) {
  return {
    id,
    label,
    ok: Boolean(ok),
    detail: String(detail || ""),
  };
}

function expectedLanguageLabel(marketCode) {
  return marketCode === "ML" ? "French" : "Spanish";
}

function expectedCurrencyLabel(marketCode) {
  return marketCode === "ML" ? "XOF" : "RD$";
}

function apiTargetIsSafe(profile) {
  if (!profile?.isConfigured || !profile?.isValidUrl) return false;
  if (profile.isProduction || profile.isPreview) {
    return profile.isHttps && !profile.isLocal;
  }
  return true;
}

export async function runLaunchValidation() {
  const checks = [];
  let selectedCity = null;
  let matchedCity = null;
  let market = getMarketConfig(null);

  checks.push(
    buildCheck(
      "api-configured",
      "API base URL configured",
      Boolean(API_BASE_URL),
      API_BASE_URL || API_CONFIG_ERROR || "EXPO_PUBLIC_API_URL is missing."
    )
  );

  checks.push(
    buildCheck(
      "api-valid-url",
      "API URL format",
      Boolean(API_TARGET_PROFILE.isValidUrl),
      API_BASE_URL || "not configured"
    )
  );

  checks.push(
    buildCheck(
      "api-target-mode",
      "API target environment classified",
      Boolean(API_TARGET_PROFILE.environment),
      describeApiTarget(API_TARGET_PROFILE)
    )
  );

  checks.push(
    buildCheck(
      "api-target-safe",
      "API target is safe for the selected launch environment",
      apiTargetIsSafe(API_TARGET_PROFILE),
      `${API_TARGET_PROFILE.label} / ${API_BASE_URL || "not configured"}`
    )
  );

  if (!API_BASE_URL || !API_TARGET_PROFILE.isValidUrl) {
    return {
      ok: checks.every((check) => check.ok),
      checks,
      market,
      apiProfile: API_TARGET_PROFILE,
      selectedCity: null,
      cityFromBackend: null,
    };
  }

  try {
    const statusResponse = await apiGet("/api/status");
    checks.push(
      buildCheck(
        "status-reachable",
        "Backend status endpoint reachable",
        Boolean(statusResponse?.ok),
        API_BASE_URL
      )
    );
  } catch (error) {
    checks.push(
      buildCheck(
        "status-reachable",
        "Backend status endpoint reachable",
        false,
        error?.message || "Could not load /api/status."
      )
    );
  }

  selectedCity = await getSelectedCity();
  checks.push(
    buildCheck(
      "city-selected",
      "Selected city exists on device",
      Boolean(selectedCity?._id),
      selectedCity?._id
        ? `${selectedCity.name} (${selectedCity.code || "N/A"})`
        : "No saved city selected."
    )
  );

  try {
    const citiesResponse = await apiGet("/api/public/cities");
    const cities = Array.isArray(citiesResponse?.cities) ? citiesResponse.cities : [];
    matchedCity =
      cities.find(
        (row) => String(row?._id || "").trim() === String(selectedCity?._id || "").trim()
      ) || null;
    market = getMarketConfig(matchedCity || selectedCity);

    checks.push(
      buildCheck(
        "cities-reachable",
        "Cities endpoint reachable",
        true,
        `${cities.length} city entries returned`
      )
    );
    checks.push(
      buildCheck(
        "city-present-backend",
        "Selected city exists on backend",
        Boolean(matchedCity?._id),
        matchedCity?._id
          ? `${matchedCity.name} (${matchedCity.code || "N/A"})`
          : "Selected city not found in /api/public/cities."
      )
    );
  } catch (error) {
    checks.push(
      buildCheck(
        "cities-reachable",
        "Cities endpoint reachable",
        false,
        error?.message || "Could not load /api/public/cities."
      )
    );
    market = getMarketConfig(selectedCity);
  }

  checks.push(
    buildCheck(
      "market-supported",
      "Selected market resolves cleanly",
      market.marketCode === "ML" || market.marketCode === "DO",
      `${market.marketCode} / ${market.countryName}`
    )
  );
  checks.push(
    buildCheck(
      "language-default",
      "Default language matches the selected market",
      market.defaultLanguage === (market.marketCode === "ML" ? "fr" : "es"),
      `${market.defaultLanguage} / expected ${expectedLanguageLabel(market.marketCode)}`
    )
  );
  checks.push(
    buildCheck(
      "currency-default",
      "Currency display matches the selected market",
      market.currencyDisplay === expectedCurrencyLabel(market.marketCode),
      `${market.currencyDisplay} / expected ${expectedCurrencyLabel(market.marketCode)}`
    )
  );
  checks.push(
    buildCheck(
      "support-whatsapp",
      "Support WhatsApp is explicitly configured or clearly marked as pending",
      true,
      market.supportWhatsAppConfigured
        ? market.supportWhatsApp
        : "Not configured yet. Replace before live launch."
    )
  );

  try {
    const restaurantsResponse = await apiGet("/api/public/restaurants?limit=3");
    const rows = Array.isArray(restaurantsResponse?.rows) ? restaurantsResponse.rows : [];
    const responseCityId = String(restaurantsResponse?.cityId || "").trim();
    checks.push(
      buildCheck(
        "restaurants-load",
        "Restaurants load for selected city",
        rows.length > 0,
        `${rows.length} restaurant(s) returned`
      )
    );
    checks.push(
      buildCheck(
        "restaurants-city-match",
        "Restaurant response matches selected city",
        !selectedCity?._id || !responseCityId || responseCityId === String(selectedCity._id),
        responseCityId || "No cityId in response"
      )
    );
  } catch (error) {
    checks.push(
      buildCheck(
        "restaurants-load",
        "Restaurants load for selected city",
        false,
        error?.message || "Could not load restaurants."
      )
    );
  }

  return {
    ok: checks.every((check) => check.ok),
    checks,
    market,
    apiProfile: API_TARGET_PROFILE,
    selectedCity,
    cityFromBackend: matchedCity,
  };
}

export const runDrPilotValidation = runLaunchValidation;
