import type { CityLean } from "@/lib/city";

export const PAYMENT_METHOD_VALUES = ["cash", "mobile_money", "wallet", "card", "paytech"] as const;
export type PaymentMethod = (typeof PAYMENT_METHOD_VALUES)[number];

export const PAYMENT_STATUS_VALUES = [
  "pending",
  "authorized",
  "paid",
  "failed",
  "cancelled",
  "refunded",
] as const;
export type PaymentStatus = (typeof PAYMENT_STATUS_VALUES)[number];

export type OrderPaymentStatus = PaymentStatus | "unpaid";

export function normalizePaymentMethod(value: unknown, fallback: PaymentMethod = "cash"): PaymentMethod {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  if (normalized === "cash") return "cash";
  if (
    normalized === "orange_money" ||
    normalized === "orangemoney" ||
    normalized === "wave" ||
    normalized === "wavemoney" ||
    normalized === "moov_money" ||
    normalized === "moovmoney"
  ) {
    return "paytech";
  }
  if (normalized === "mobile_money" || normalized === "mobilemoney") return "mobile_money";
  if (normalized === "wallet") return "wallet";
  if (normalized === "card") return "card";
  if (normalized === "paytech") return "paytech";
  return fallback;
}

export function normalizePaymentStatus(value: unknown, fallback: PaymentStatus = "pending"): PaymentStatus {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  if (normalized === "unpaid" || !normalized) return fallback;
  if (normalized === "pending") return "pending";
  if (normalized === "authorized") return "authorized";
  if (normalized === "paid") return "paid";
  if (normalized === "failed") return "failed";
  if (normalized === "cancelled" || normalized === "canceled") return "cancelled";
  if (normalized === "refunded") return "refunded";
  return fallback;
}

export function normalizeLegacyPaymentStatus(value: unknown): OrderPaymentStatus {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  if (normalized === "unpaid") return "unpaid";
  return normalizePaymentStatus(normalized);
}

export function paymentMethodLabel(method: unknown) {
  switch (normalizePaymentMethod(method)) {
    case "mobile_money":
      return "Mobile money";
    case "wallet":
      return "Wallet";
    case "card":
      return "Card";
    case "paytech":
      return "PayTech";
    default:
      return "Cash on delivery";
  }
}

export function paymentStatusLabel(status: unknown) {
  const normalized = normalizePaymentStatus(status);
  switch (normalized) {
    case "authorized":
      return "Authorized";
    case "paid":
      return "Paid";
    case "failed":
      return "Failed";
    case "cancelled":
      return "Cancelled";
    case "refunded":
      return "Refunded";
    default:
      return "Pending";
  }
}

function normalizeCityPaymentMethod(value: unknown) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z]/g, "");
}

export function citySupportsPaymentMethod(
  city: Partial<Pick<CityLean, "paymentMethods" | "code" | "country">>,
  method: PaymentMethod
) {
  const methods = Array.isArray(city.paymentMethods) ? city.paymentMethods : [];
  const cityCode = String(city.code || "").trim().toUpperCase();
  const country = String(city.country || "").trim().toLowerCase();
  const isBamakoMarket = cityCode === "BKO" || country === "mali";
  if (!methods.length) {
    if (method === "cash") return true;
    if (isBamakoMarket && (method === "mobile_money" || method === "paytech")) {
      return true;
    }
    return false;
  }

  const normalized = methods.map(normalizeCityPaymentMethod);
  const hasDigitalMethod = normalized.some((value) =>
    ["mobilemoney", "orangemoney", "moovmoney", "wave", "wavemoney", "paytech"].includes(value)
  );
  if (method === "cash") {
    return normalized.includes("cash");
  }
  if (isBamakoMarket && !hasDigitalMethod && (method === "mobile_money" || method === "paytech")) {
    return true;
  }
  if (method === "mobile_money") {
    return normalized.some((value) =>
      ["mobilemoney", "orangemoney", "moovmoney", "wave", "wavemoney", "paytech"].includes(value)
    );
  }
  if (method === "wallet") {
    return normalized.includes("wallet");
  }
  if (method === "card") {
    return normalized.includes("card");
  }
  if (method === "paytech") {
    return normalized.some((value) =>
      ["paytech", "mobilemoney", "orangemoney", "moovmoney", "wave", "wavemoney"].includes(value)
    );
  }
  return false;
}

export function getInitialPaymentProvider(method: PaymentMethod, provider?: unknown) {
  const trimmed = String(provider || "").trim();
  if (trimmed) return trimmed;
  if (method === "mobile_money") return "manual_mobile_money";
  if (method === "paytech") return "paytech";
  return null;
}
