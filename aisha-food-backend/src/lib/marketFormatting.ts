import { getMarketConfig, getMarketLocale } from "@/lib/marketConfig";

type MarketLike = {
  marketCode?: string | null;
  code?: string | null;
  slug?: string | null;
  name?: string | null;
  country?: string | null;
  currency?: string | null;
  currencyCode?: string | null;
  currencyDisplay?: string | null;
  supportWhatsApp?: string | null;
  supportWhatsAppE164?: string | null;
  paymentMethods?: string[] | null;
  defaultLanguage?: string | null;
  defaultTimezone?: string | null;
  timezone?: string | null;
};

export type MarketFormattingProfile = ReturnType<typeof buildMarketFormattingProfile>;

function normalizeDigits(value: unknown) {
  return String(value || "").replace(/\D+/g, "");
}

function toMarketConfigInput(input?: MarketLike | null) {
  if (!input) return null;
  return {
    code: input.code ?? undefined,
    slug: input.slug ?? undefined,
    name: input.name ?? undefined,
    country: input.country ?? undefined,
    currency: input.currency ?? undefined,
    currencyCode: input.currencyCode ?? undefined,
    supportWhatsApp: input.supportWhatsApp ?? undefined,
    supportWhatsAppE164: input.supportWhatsAppE164 ?? undefined,
    paymentMethods: input.paymentMethods ?? undefined,
  };
}

export function buildMarketFormattingProfile(input?: MarketLike | null) {
  const marketInput = toMarketConfigInput(input);
  const market = getMarketConfig(marketInput);
  const locale = getMarketLocale(marketInput);
  const timezone = String(input?.timezone || input?.defaultTimezone || market.defaultTimezone).trim() || market.defaultTimezone;
  const supportWhatsApp = normalizeDigits(market.supportWhatsApp);

  return {
    marketCode: market.marketCode,
    countryName: market.countryName,
    defaultLanguage: market.defaultLanguage,
    allowedLanguages: market.allowedLanguages,
    currencyCode: market.currencyCode,
    currencyDisplay: market.currencyDisplay,
    supportWhatsApp,
    supportWhatsAppIsPlaceholder: market.supportWhatsAppIsPlaceholder,
    supportWhatsAppConfigured:
      supportWhatsApp.length >= 7 && !market.supportWhatsAppIsPlaceholder,
    defaultTimezone: market.defaultTimezone,
    paymentMethods: market.paymentMethods,
    locale,
    timezone,
  };
}

function moneyFractionDigits(profile: MarketFormattingProfile) {
  return profile.currencyCode === "XOF" ? 0 : 2;
}

export function formatMoneyForProfile(
  value: number | null | undefined,
  profile: MarketFormattingProfile
) {
  const safeValue = Number.isFinite(Number(value)) ? Number(value) : 0;
  const fractionDigits = moneyFractionDigits(profile);
  if (profile.currencyCode === "XOF") {
    return `${new Intl.NumberFormat(profile.locale, {
      minimumFractionDigits: fractionDigits,
      maximumFractionDigits: fractionDigits,
    }).format(safeValue)} ${profile.currencyDisplay || "FCFA"}`;
  }
  return new Intl.NumberFormat(profile.locale, {
    style: "currency",
    currency: profile.currencyCode,
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(safeValue);
}

export function formatDateTimeForProfile(
  value: string | Date | null | undefined,
  profile: MarketFormattingProfile,
  options?: Intl.DateTimeFormatOptions
) {
  if (!value) return "-";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  const hasGranularOptions = Boolean(
    options &&
      [
        "weekday",
        "era",
        "year",
        "month",
        "day",
        "hour",
        "minute",
        "second",
        "timeZoneName",
      ].some((key) => key in options)
  );
  return new Intl.DateTimeFormat(profile.locale, {
    timeZone: profile.timezone,
    ...(hasGranularOptions
      ? {}
      : {
          dateStyle: "short",
          timeStyle: "short",
        }),
    ...(options || {}),
  }).format(date);
}

export function formatDateForProfile(
  value: string | Date | null | undefined,
  profile: MarketFormattingProfile,
  options?: Intl.DateTimeFormatOptions
) {
  if (!value) return "-";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat(profile.locale, {
    timeZone: profile.timezone,
    month: "short",
    day: "numeric",
    ...(options || {}),
  }).format(date);
}
