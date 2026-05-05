export const DO_SUPPORT_WHATSAPP_PLACEHOLDER = "";
export const ML_SUPPORT_WHATSAPP_PLACEHOLDER = "";

const GENERIC_SUPPORT_WHATSAPP_NUMBER = normalizeDigits(
  process.env.EXPO_PUBLIC_SUPPORT_WHATSAPP_NUMBER || "+447490493787"
);
const DO_SUPPORT_WHATSAPP_DEFAULT =
  normalizeDigits(process.env.EXPO_PUBLIC_SUPPORT_WHATSAPP_NUMBER_DO) ||
  GENERIC_SUPPORT_WHATSAPP_NUMBER ||
  DO_SUPPORT_WHATSAPP_PLACEHOLDER;
const ML_SUPPORT_WHATSAPP_DEFAULT =
  normalizeDigits(process.env.EXPO_PUBLIC_SUPPORT_WHATSAPP_NUMBER_ML) ||
  GENERIC_SUPPORT_WHATSAPP_NUMBER ||
  ML_SUPPORT_WHATSAPP_PLACEHOLDER;

const MARKET_DEFAULTS = {
  DO: {
    marketCode: "DO",
    countryName: "Dominican Republic",
    defaultLanguage: "es",
    allowedLanguages: ["es", "en"],
    currencyCode: "DOP",
    currencyDisplay: "RD$",
    supportWhatsApp: DO_SUPPORT_WHATSAPP_DEFAULT,
    supportWhatsAppIsPlaceholder: true,
    defaultTimezone: "America/Santo_Domingo",
    paymentMethods: ["cash"],
  },
  ML: {
    marketCode: "ML",
    countryName: "Mali",
    defaultLanguage: "fr",
    allowedLanguages: ["fr", "bm", "en"],
    currencyCode: "XOF",
    currencyDisplay: "XOF",
    supportWhatsApp: ML_SUPPORT_WHATSAPP_DEFAULT,
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
  },
};
const PAYMENT_METHOD_FALLBACK = ["cash", "mobile_money", "paytech"];
const PLACEHOLDER_SUPPORT_NUMBERS = new Set([
  normalizeDigits(DO_SUPPORT_WHATSAPP_PLACEHOLDER),
  normalizeDigits(ML_SUPPORT_WHATSAPP_PLACEHOLDER),
].filter(Boolean));

const LEGACY_PLACEHOLDER_SUPPORT_NUMBERS = new Set([
  "18090000000",
  "22300000000",
]);

function normalize(value) {
  return String(value || "").trim();
}

function normalizeUpper(value) {
  return normalize(value).toUpperCase();
}

function normalizeLower(value) {
  return normalize(value).toLowerCase();
}

function normalizeDigits(value) {
  return normalize(value).replace(/\D+/g, "");
}

function configuredDefaultMarketCode() {
  const explicitMarketCode = normalizeUpper(process.env.EXPO_PUBLIC_DEFAULT_MARKET_CODE);
  if (explicitMarketCode === "ML" || explicitMarketCode === "DO") {
    return explicitMarketCode;
  }

  const launchCityCode = normalizeUpper(
    process.env.EXPO_PUBLIC_DEFAULT_CITY_CODE || process.env.EXPO_PUBLIC_LAUNCH_CITY_CODE
  );
  if (launchCityCode === "SDQ") return "DO";
  if (launchCityCode === "BKO") return "ML";
  return "ML";
}

function inferMarketCode(cityOrMarket) {
  const code = normalizeUpper(cityOrMarket?.marketCode || cityOrMarket?.code);
  const slug = normalizeLower(cityOrMarket?.slug);
  const name = normalizeLower(cityOrMarket?.name);
  const country = normalizeLower(cityOrMarket?.country || cityOrMarket?.countryName);
  const currency = normalizeUpper(cityOrMarket?.currencyCode || cityOrMarket?.currency);

  if (
    code === "ML" ||
    code === "BKO" ||
    slug === "bamako" ||
    name === "bamako" ||
    country === "mali" ||
    currency === "XOF" ||
    currency === "CFA" ||
    currency === "FCFA"
  ) {
    return "ML";
  }

  if (
    code === "DO" ||
    code === "SDQ" ||
    slug.includes("santo-domingo") ||
    slug.includes("santo domingo") ||
    name.includes("santo domingo") ||
    country.includes("dominican") ||
    currency === "DOP"
  ) {
    return "DO";
  }

  return configuredDefaultMarketCode();
}

function isPlaceholderSupportNumber(value) {
  const normalized = normalizeDigits(value);
  return (
    !normalized ||
    LEGACY_PLACEHOLDER_SUPPORT_NUMBERS.has(normalized) ||
    PLACEHOLDER_SUPPORT_NUMBERS.has(normalized)
  );
}

function normalizePaymentMethods(cityOrMarket, fallbackMethods) {
  const raw = Array.isArray(cityOrMarket?.paymentMethods) ? cityOrMarket.paymentMethods : [];
  if (!raw.length) return [...fallbackMethods];

  const methods = new Set();
  raw.forEach((value) => {
    const normalized = normalizeLower(value);
    if (normalized === "cash") {
      methods.add("cash");
      return;
    }
    if (
      normalized === "orange_money" ||
      normalized === "mobile_money" ||
      normalized === "orangemoney" ||
      normalized === "moov_money" ||
      normalized === "moovmoney" ||
      normalized === "wave" ||
      normalized === "wavemoney"
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
      return;
    }
    if (normalized === "paytech") {
      methods.add("paytech");
    }
  });

  if (!methods.size) {
    return [...fallbackMethods];
  }

  const isBamakoMarket =
    inferMarketCode(cityOrMarket) === "ML" &&
    (normalizeUpper(cityOrMarket?.code) === "BKO" ||
      normalizeLower(cityOrMarket?.name) === "bamako" ||
      normalizeLower(cityOrMarket?.country || cityOrMarket?.countryName) === "mali");
  const hasDigitalMethods = Array.from(methods).some((method) =>
    ["orange_money", "wave", "moov_money", "mobile_money", "paytech"].includes(method)
  );
  if (isBamakoMarket && !hasDigitalMethods) {
    return [...MARKET_DEFAULTS.ML.paymentMethods];
  }

  return Array.from(methods);
}

export function getMarketConfig(cityOrMarket) {
  const marketCode = inferMarketCode(cityOrMarket);
  const base = MARKET_DEFAULTS[marketCode];
  const supportWhatsApp =
    normalizeDigits(cityOrMarket?.supportWhatsApp || cityOrMarket?.supportWhatsAppE164) ||
    base.supportWhatsApp;

  return {
    ...base,
    marketCode,
    countryName: normalize(cityOrMarket?.country || cityOrMarket?.countryName) || base.countryName,
    defaultLanguage:
      base.allowedLanguages.includes(normalizeLower(cityOrMarket?.defaultLanguage))
        ? normalizeLower(cityOrMarket?.defaultLanguage)
        : base.defaultLanguage,
    allowedLanguages:
      Array.isArray(cityOrMarket?.allowedLanguages) && cityOrMarket.allowedLanguages.length
        ? cityOrMarket.allowedLanguages
            .map((value) => normalizeLower(value))
            .filter((value, index, values) => value && values.indexOf(value) === index)
        : [...base.allowedLanguages],
    currencyCode:
      normalizeUpper(cityOrMarket?.currencyCode || cityOrMarket?.currency) === "XOF"
        ? "XOF"
        : base.currencyCode,
    currencyDisplay:
      normalizeUpper(cityOrMarket?.currencyDisplay) === "RD$"
        ? "RD$"
        : normalizeUpper(cityOrMarket?.currencyDisplay) === "XOF"
        ? "XOF"
        : base.currencyDisplay,
    supportWhatsApp,
    supportWhatsAppIsPlaceholder:
      PLACEHOLDER_SUPPORT_NUMBERS.has(supportWhatsApp) || isPlaceholderSupportNumber(supportWhatsApp),
    supportWhatsAppConfigured: !isPlaceholderSupportNumber(supportWhatsApp),
    defaultTimezone: normalize(cityOrMarket?.defaultTimezone) || base.defaultTimezone,
    paymentMethods: normalizePaymentMethods(
      cityOrMarket,
      Array.isArray(base.paymentMethods) && base.paymentMethods.length
        ? base.paymentMethods
        : PAYMENT_METHOD_FALLBACK
    ),
  };
}

export function normalizePreferredLanguage(value, cityOrMarket) {
  const market = getMarketConfig(cityOrMarket);
  const normalized = normalizeLower(value);
  return market.allowedLanguages.includes(normalized) ? normalized : market.defaultLanguage;
}

export function getLanguageOptions(cityOrMarket) {
  const market = getMarketConfig(cityOrMarket);
  return market.allowedLanguages.map((value) => ({
    value,
    label:
      value === "es"
        ? "Espanol"
        : value === "fr"
        ? "Francais"
        : value === "bm"
        ? "Bambara"
        : "English",
  }));
}

export function formatCurrencyAmount(amount, cityOrMarket) {
  const market = getMarketConfig(cityOrMarket);
  const numericAmount = Number(amount || 0);
  const safeAmount = Number.isFinite(numericAmount) ? Math.round(numericAmount) : 0;
  if (market.currencyDisplay === "RD$") {
    return `RD$ ${safeAmount}`;
  }
  return `${safeAmount} ${market.currencyDisplay || market.currencyCode || "XOF"}`;
}

export function getSupportWhatsAppNumber(cityOrMarket) {
  return getMarketConfig(cityOrMarket).supportWhatsApp;
}

export function getMarketLocale(cityOrMarket) {
  const market = getMarketConfig(cityOrMarket);
  if (market.marketCode === "ML") return "fr-ML";
  return "es-DO";
}
