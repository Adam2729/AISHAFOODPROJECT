import type { CityLean } from "@/lib/city";

export type MarketCode = "DO" | "ML" | "SN";
export type MarketLanguage = "es" | "fr" | "bm" | "en";
export type MarketPaymentMethod =
  | "cash"
  | "orange_money"
  | "orange_money_ml"
  | "orange_money_sn"
  | "wave"
  | "moov_money"
  | "moov_money_ml"
  | "mobile_money"
  | "paytech"
  | "card";

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
  currencyDisplay: "RD$" | "FCFA";
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
  allowedLanguages: ["fr", "bm"],
  currencyCode: "XOF",
  currencyDisplay: "FCFA",
  supportWhatsApp: ML_SUPPORT_WHATSAPP_PLACEHOLDER,
  supportWhatsAppIsPlaceholder: true,
  defaultTimezone: "Africa/Bamako",
  paymentMethods: [
    "cash",
    "orange_money_ml",
    "wave",
    "moov_money_ml",
    "paytech",
  ],
};

const SN_MARKET: MarketConfig = {
  marketCode: "SN",
  countryName: "Senegal",
  defaultLanguage: "fr",
  allowedLanguages: ["fr", "en"],
  currencyCode: "XOF",
  currencyDisplay: "FCFA",
  supportWhatsApp: ML_SUPPORT_WHATSAPP_PLACEHOLDER,
  supportWhatsAppIsPlaceholder: true,
  defaultTimezone: "Africa/Dakar",
  paymentMethods: ["cash", "orange_money_sn", "wave", "paytech", "card"],
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
  const code = normalizeUpper(city?.code || (city as { marketCode?: unknown } | null)?.marketCode);
  const slug = normalizeLower(city?.slug);
  const name = normalizeLower(city?.name);
  const country = normalizeLower(city?.country);
  const currency =
    normalizeUpper(city?.currencyCode) || normalizeUpper(city?.currency);

  if (
    code === "SN" ||
    code === "DKR" ||
    slug === "dakar" ||
    name === "dakar" ||
    country === "senegal"
  ) {
    return "SN";
  }

  if (
    code === "ML" ||
    code === "BKO" ||
    slug === "bamako" ||
    name === "bamako" ||
    country === "mali"
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
    return market.marketCode === "ML" || market.marketCode === "SN"
      ? [...market.paymentMethods]
      : [...PAYMENT_METHOD_FALLBACK];
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
      normalized === "orange_money_ml" ||
      normalized === "orange_money_sn" ||
      normalized === "mobile_money" ||
      normalized === "orangemoney" ||
      normalized === "moov_money" ||
      normalized === "moov_money_ml" ||
      normalized === "moovmoney" ||
      normalized === "wave" ||
      normalized === "wavemoney" ||
      normalized === "momo"
    ) {
      if (
        normalized === "orange_money_ml" ||
        ((normalized === "orange_money" || normalized === "orangemoney") &&
          market.marketCode === "ML")
      ) {
        methods.add("orange_money_ml");
      }
      if (
        normalized === "orange_money_sn" ||
        ((normalized === "orange_money" || normalized === "orangemoney") &&
          market.marketCode === "SN")
      ) {
        methods.add("orange_money_sn");
      }
      if (normalized === "wave" || normalized === "wavemoney") {
        methods.add("wave");
      }
      if (
        normalized === "moov_money_ml" ||
        normalized === "moov_money" ||
        normalized === "moovmoney"
      ) {
        methods.add("moov_money_ml");
      }
      if (normalized === "mobile_money" || normalized === "momo") {
        if (market.marketCode === "SN") {
          methods.add("orange_money_sn");
          methods.add("wave");
        } else {
          methods.add("orange_money_ml");
          methods.add("moov_money_ml");
          methods.add("wave");
        }
      }
      continue;
    }
    if (normalized === "paytech") {
      methods.add("paytech");
      continue;
    }
    if (normalized === "card" || normalized === "carte" || normalized === "carte_bancaire") {
      methods.add("card");
    }
  }

  if (!methods.size) {
    return market.marketCode === "ML" || market.marketCode === "SN"
      ? [...market.paymentMethods]
      : [...PAYMENT_METHOD_FALLBACK];
  }

  const hasDigitalMethods = Array.from(methods).some((method) =>
    [
      "orange_money",
      "orange_money_ml",
      "orange_money_sn",
      "wave",
      "moov_money",
      "moov_money_ml",
      "mobile_money",
      "paytech",
      "card",
    ].includes(method)
  );
  if ((market.marketCode === "ML" || market.marketCode === "SN") && !hasDigitalMethods) {
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
  const marketCode = resolveMarketCode(city);
  const market =
    marketCode === "ML" ? ML_MARKET : marketCode === "SN" ? SN_MARKET : DO_MARKET;
  const supportWhatsApp = deriveSupportWhatsApp(city, market.supportWhatsApp);
  const cityAllowedLanguages = (city as { allowedLanguages?: unknown[] } | null)?.allowedLanguages;
  const normalizedAllowedLanguages = Array.isArray(cityAllowedLanguages)
    ? cityAllowedLanguages
        .map((value) => normalizeLower(value) as MarketLanguage)
        .filter(
          (value, index, values) =>
            Boolean(value) &&
            values.indexOf(value) === index &&
            market.allowedLanguages.includes(value)
        )
    : [];

  return {
    ...market,
    countryName: normalize(city?.country) || market.countryName,
    allowedLanguages: normalizedAllowedLanguages.length
      ? normalizedAllowedLanguages
      : market.allowedLanguages,
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
  const marketCode = resolveMarketCode(city);
  if (marketCode === "ML") return "fr-ML";
  if (marketCode === "SN") return "fr-SN";
  return "es-DO";
}
