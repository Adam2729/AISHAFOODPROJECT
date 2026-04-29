export const MERCHANT_TYPES = [
  "restaurant",
  "corner_shop",
  "grocery",
  "bakery",
  "pharmacy",
] as const;

export const ACTIVE_MERCHANT_TYPES = [
  "restaurant",
  "corner_shop",
  "grocery",
  "bakery",
] as const;

export const DELIVERY_TYPES = ["own_driver", "platform_driver"] as const;

export const PAYOUT_METHODS = [
  "bank_transfer",
  "mobile_money",
  "cash_collection",
  "weekly_cashout",
] as const;

export type MerchantType = (typeof MERCHANT_TYPES)[number];
export type ActiveMerchantType = (typeof ACTIVE_MERCHANT_TYPES)[number];
export type DeliveryType = (typeof DELIVERY_TYPES)[number];
export type PayoutMethod = (typeof PAYOUT_METHODS)[number];

export function isMerchantType(value: unknown): value is MerchantType {
  return MERCHANT_TYPES.includes(String(value || "").trim() as MerchantType);
}

export function isActiveMerchantType(value: unknown): value is ActiveMerchantType {
  return ACTIVE_MERCHANT_TYPES.includes(String(value || "").trim() as ActiveMerchantType);
}

export function isDeliveryType(value: unknown): value is DeliveryType {
  return DELIVERY_TYPES.includes(String(value || "").trim() as DeliveryType);
}

export function isPayoutMethod(value: unknown): value is PayoutMethod {
  return PAYOUT_METHODS.includes(String(value || "").trim() as PayoutMethod);
}

export function getMerchantTypeLabel(value: unknown) {
  switch (String(value || "").trim()) {
    case "restaurant":
      return "Restaurant";
    case "corner_shop":
      return "Corner Shop";
    case "grocery":
      return "Grocery / Mini Market";
    case "bakery":
      return "Bakery";
    case "pharmacy":
      return "Pharmacy";
    default:
      return "Merchant";
  }
}

export function getDeliveryTypeLabel(value: unknown) {
  return String(value || "").trim() === "platform_driver"
    ? "Aisha Food drivers"
    : "Own drivers";
}

export function getMerchantTypeDescription(value: unknown) {
  switch (String(value || "").trim()) {
    case "restaurant":
      return "Meals, drinks, desserts, and prep-time driven orders.";
    case "corner_shop":
      return "Fast-moving convenience items with lightweight inventory.";
    case "grocery":
      return "Mini market catalog with broader household and grocery items.";
    case "bakery":
      return "Fresh baked goods, beverages, and scheduled prep items.";
    case "pharmacy":
      return "Pharmacy onboarding can be activated later when compliance is ready.";
    default:
      return "General merchant onboarding.";
  }
}

export function mapMerchantTypeToBusinessType(value: unknown) {
  const merchantType = String(value || "").trim();
  if (merchantType === "restaurant" || merchantType === "bakery") {
    return "restaurant" as const;
  }
  return "colmado" as const;
}

export function defaultDeliveryTypeForMarket(marketCode: unknown): DeliveryType {
  const normalizedMarketCode = String(marketCode || "").trim().toUpperCase();
  const defaultsByMarket: Record<string, DeliveryType> = {
    DO: "own_driver",
    ML: "own_driver",
  };
  return defaultsByMarket[normalizedMarketCode] || "own_driver";
}

export function getDefaultDeliveryNoteEs(deliveryType: unknown) {
  return String(deliveryType || "").trim() === "platform_driver"
    ? "Entrega coordinada con repartidores de Aisha Food"
    : "Entrega manejada por el negocio";
}

export function normalizeMerchantType(value: unknown): ActiveMerchantType {
  return isActiveMerchantType(value) ? value : "restaurant";
}

export function normalizeDeliveryType(value: unknown, marketCode?: unknown): DeliveryType {
  if (isDeliveryType(value)) return value;
  return defaultDeliveryTypeForMarket(marketCode);
}

export function normalizePayoutMethod(value: unknown): PayoutMethod {
  return isPayoutMethod(value) ? value : "cash_collection";
}
