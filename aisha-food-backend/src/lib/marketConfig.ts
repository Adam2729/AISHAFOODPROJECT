import type { CityLean } from "@/lib/city";

export type MarketCode = "DO" | "ML";
export type MarketLanguage = "es" | "fr" | "bm" | "en";
export type MarketPaymentMethod =
  | "cash"
  | "orange_money"
  | "wave"
  | "moov_money"
  | "mobile_money"
  | "paytech";

type CityLike = Partial<
  Pick<
    CityLean,
    | "code"
    | "slug"
    | "name"
    | "country"
    | "supportWhatsAppE164"
  >
> & {
  currency?: string | null;
  currencyCode?: string | null;
  supportWhatsApp?: string | null;
  paymentMethods?: string[] | null;
};

export type MarketConfig = {
  marketCode: MarketCode;
  countryName: string;
  defaultLanguage: MarketLanguage;
  allowedLanguages: MarketLanguage[];
  currencyCode: "DOP" | "XOF";
  currencyDisplay: "RD$" | "XOF";
  supportWhatsApp: string;
  supportWhatsAppIsPlaceholder: boolean;
  defaultTimezone: string;
  paymentMethods: MarketPaymentMethod[];
};

export const DO_SUPPORT_WHATSAPP_PLACEHOLDER = "";
export const ML_SUPPORT_WHATSAPP_PLACEHOLDER = "";
const DEFAULT_LAUNCH_CITY_CODE = "BKO";

const DO_MARKET: MarketConfig = {
  marketCode: "DO",
  countryName: "Dominican Republic",
  defaultLanguage: "es",
  allowedLanguages: ["es", "en"],
  currencyCode: "DOP",
  currencyDisplay: "RD$",
  supportWhatsApp: DO_SUPPORT_WHATSAPP_PLACEHOLDER,
  supportWhatsAppIsPlaceholder: true,
  defaultTimezone: "America/Santo_Domingo",
  paymentMethods: ["cash"],
};

const ML_MARKET: MarketConfig = {
  marketCode: "ML",
  countryName: "Mali",
  defaultLanguage: "fr",
  allowedLanguages: ["fr", "bm", "en"],
  currencyCode: "XOF",
  currencyDisplay: "XOF",
  supportWhatsApp: ML_SUPPORT_WHATSAPP_PLACEHOLDER,
  supportWhatsAppIsPlaceholder: true,
  defaultTimezone: "Africa/Bamako",
  paymentMethods: [
    "cash",
    "orange_money",
    "wave",
    "moov_money",
    "mobile_money",
    "paytech",
  ],
};

const PAYMENT_METHOD_FALLBACK: MarketPaymentMethod[] = ["cash", "mobile_money", "paytech"];

function normalize(value: unknown) {
  return String(value || "").trim();
}

function normalizeUpper(value: unknown) {
  return normalize(value).toUpperCase();
}

function normalizeLower(value: unknown) {
  return normalize(value).toLowerCase();
}

function normalizeDigits(value: unknown) {
  return normalize(value).replace(/\D+/g, "");
}

function readLaunchCityCode() {
  // Keep this module safe for both client and server imports.
  return normalizeUpper(process.env.NEXT_PUBLIC_LAUNCH_CITY_CODE) || DEFAULT_LAUNCH_CITY_CODE;
}

function launchDefaultMarketCode(): MarketCode {
  return readLaunchCityCode() === "SDQ" ? "DO" : "ML";
}

export function resolveMarketCode(city?: CityLike | null): MarketCode {
  const code = normalizeUpper(city?.code);
  const slug = normalizeLower(city?.slug);
  const name = normalizeLower(city?.name);
  const country = normalizeLower(city?.country);
  const currency =
    normalizeUpper(city?.currencyCode) || normalizeUpper(city?.currency);

  if (
    code === "BKO" ||
    slug === "bamako" ||
    name === "bamako" ||
    country === "mali" ||
    currency === "CFA" ||
    currency === "XOF"
  ) {
    return "ML";
  }

  if (
    code === "SDQ" ||
    slug.includes("santo-domingo") ||
    slug.includes("santo domingo") ||
    name.includes("santo domingo") ||
    country.includes("dominican") ||
    currency === "DOP"
  ) {
    return "DO";
  }

  return launchDefaultMarketCode();
}

function deriveSupportWhatsApp(city: CityLike | null | undefined, fallback: string) {
  return (
    normalizeDigits(city?.supportWhatsApp) ||
    normalizeDigits(city?.supportWhatsAppE164) ||
    fallback
  );
}

function derivePaymentMethods(city: CityLike | null | undefined, market: MarketConfig) {
  const raw = Array.isArray(city?.paymentMethods) ? city?.paymentMethods : [];
  if (!raw.length) {
    return market.marketCode === "ML" ? [...market.paymentMethods] : [...PAYMENT_METHOD_FALLBACK];
  }

  const methods = new Set<MarketPaymentMethod>();
  for (const value of raw) {
    const normalized = normalizeLower(value);
    if (normalized === "cash") {
      methods.add("cash");
      continue;
    }
    if (
      normalized === "orange_money" ||
      normalized === "mobile_money" ||
      normalized === "orangemoney" ||
      normalized === "moov_money" ||
      normalized === "moovmoney" ||
      normalized === "wave" ||
      normalized === "wavemoney" ||
      normalized === "momo"
    ) {
      if (normalized === "orange_money" || normalized === "orangemoney") {
        methods.add("orange_money");
      }
      if (normalized === "wave" || normalized === "wavemoney") {
        methods.add("wave");
      }
      if (normalized === "moov_money" || normalized === "moovmoney") {
        methods.add("moov_money");
      }
      methods.add("mobile_money");
      continue;
    }
    if (normalized === "paytech") {
      methods.add("paytech");
    }
  }

  if (!methods.size) {
    return market.marketCode === "ML" ? [...market.paymentMethods] : [...PAYMENT_METHOD_FALLBACK];
  }

  const hasDigitalMethods = Array.from(methods).some((method) =>
    ["orange_money", "wave", "moov_money", "mobile_money", "paytech"].includes(method)
  );
  if (market.marketCode === "ML" && !hasDigitalMethods) {
    return [...market.paymentMethods];
  }

  return Array.from(methods);
}

function isPlaceholderSupportWhatsApp(value: string) {
  const normalized = normalizeDigits(value);
  return (
    !normalized ||
    normalized === "18090000000" ||
    normalized === "22300000000" ||
    normalized === DO_SUPPORT_WHATSAPP_PLACEHOLDER ||
    normalized === ML_SUPPORT_WHATSAPP_PLACEHOLDER
  );
}

export function getMarketConfig(city?: CityLike | null): MarketConfig {
  const market = resolveMarketCode(city) === "ML" ? ML_MARKET : DO_MARKET;
  const supportWhatsApp = deriveSupportWhatsApp(city, market.supportWhatsApp);

  return {
    ...market,
    countryName: normalize(city?.country) || market.countryName,
    supportWhatsApp,
    supportWhatsAppIsPlaceholder: isPlaceholderSupportWhatsApp(supportWhatsApp),
    paymentMethods: derivePaymentMethods(city, market),
  };
}

export function isLanguageAllowedForMarket(city: CityLike | null | undefined, language: unknown) {
  const market = getMarketConfig(city);
  const normalized = normalizeLower(language) as MarketLanguage;
  return market.allowedLanguages.includes(normalized);
}

export function normalizeLanguageForMarket(
  city: CityLike | null | undefined,
  language?: unknown
): MarketLanguage {
  const market = getMarketConfig(city);
  const normalized = normalizeLower(language) as MarketLanguage;
  if (market.allowedLanguages.includes(normalized)) {
    return normalized;
  }
  return market.defaultLanguage;
}

export function getCurrencyDisplay(city?: CityLike | null) {
  return getMarketConfig(city).currencyDisplay;
}

export function getCurrencyCode(city?: CityLike | null) {
  return getMarketConfig(city).currencyCode;
}

export function getDefaultTimezoneForCity(city?: CityLike | null) {
  return getMarketConfig(city).defaultTimezone;
}

export function getMarketLocale(city?: CityLike | null) {
  return resolveMarketCode(city) === "ML" ? "fr-ML" : "es-DO";
}
