import { getDefaultDeliveryNoteEs, type DeliveryType } from "@/lib/merchantOnboarding";

export type DeliveryMode = "self_delivery" | "platform_driver";

type DeliveryPolicyInput = {
  mode?: string | null;
  publicNoteEs?: string | null;
  courierName?: string | null;
  courierPhone?: string | null;
  instructionsEs?: string | null;
  updatedAt?: Date | string | null;
};

type BusinessWithDeliveryPolicy = {
  deliveryType?: string | null;
  deliveryPolicy?: DeliveryPolicyInput | null;
};

type OrderDeliveryInput = {
  deliverySnapshot?: {
    mode?: string | null;
  } | null;
  dispatch?: {
    assignedDriverId?: unknown;
  } | null;
  merchantDelivery?: {
    assignedAt?: unknown;
    riderName?: string | null;
    riderPhone?: string | null;
  } | null;
};

function normalizeString(value: unknown) {
  return String(value || "").trim();
}

export function normalizeDeliveryMode(
  value: unknown,
  fallback: DeliveryMode = "self_delivery"
): DeliveryMode {
  const normalized = normalizeString(value);
  if (normalized === "platform_driver") return "platform_driver";
  if (normalized === "self_delivery") return "self_delivery";
  return fallback;
}

export function deliveryTypeToMode(deliveryType: unknown): DeliveryMode {
  return normalizeString(deliveryType) === "platform_driver"
    ? "platform_driver"
    : "self_delivery";
}

export function deliveryModeToType(mode: unknown): DeliveryType {
  return normalizeDeliveryMode(mode) === "platform_driver"
    ? "platform_driver"
    : "own_driver";
}

export function getDefaultDeliveryPolicy(deliveryType: unknown) {
  const mode = deliveryTypeToMode(deliveryType);
  return {
    mode,
    publicNoteEs: getDefaultDeliveryNoteEs(deliveryModeToType(mode)),
  };
}

export function resolveBusinessDeliveryMode(business: BusinessWithDeliveryPolicy): DeliveryMode {
  const policy = business?.deliveryPolicy || {};
  const fallbackMode = deliveryTypeToMode(business?.deliveryType);
  return normalizeDeliveryMode(policy.mode, fallbackMode);
}

export function resolveOperationalOrderDeliveryMode(
  order: OrderDeliveryInput | null | undefined,
  business?: Pick<BusinessWithDeliveryPolicy, "deliveryType"> | null
): DeliveryMode {
  const hasDispatchDriver = Boolean(order?.dispatch?.assignedDriverId);
  if (hasDispatchDriver) return "platform_driver";

  const hasMerchantDriverAssignment =
    Boolean(order?.merchantDelivery?.assignedAt) ||
    Boolean(normalizeString(order?.merchantDelivery?.riderName)) ||
    Boolean(normalizeString(order?.merchantDelivery?.riderPhone));
  if (hasMerchantDriverAssignment) return "self_delivery";

  const businessMode = deliveryTypeToMode(business?.deliveryType);
  const snapshotMode = normalizeDeliveryMode(order?.deliverySnapshot?.mode, businessMode);
  if (snapshotMode === "platform_driver") return "platform_driver";
  if (businessMode === "platform_driver") return "platform_driver";
  return "self_delivery";
}

export function getPublicDeliveryInfo(business: BusinessWithDeliveryPolicy) {
  const policy = business?.deliveryPolicy || {};
  const mode = resolveBusinessDeliveryMode(business);
  const publicNoteEs =
    normalizeString(policy.publicNoteEs) ||
    getDefaultDeliveryNoteEs(deliveryModeToType(mode));
  return {
    mode,
    publicNoteEs,
  };
}

export function getMerchantDeliveryInfo(business: BusinessWithDeliveryPolicy) {
  const policy = business?.deliveryPolicy || {};
  const publicInfo = getPublicDeliveryInfo(business);
  return {
    mode: publicInfo.mode,
    publicNoteEs: publicInfo.publicNoteEs,
    courierName: String(policy.courierName || "").trim() || null,
    courierPhone: String(policy.courierPhone || "").trim() || null,
    instructionsEs: String(policy.instructionsEs || "").trim() || null,
    updatedAt: policy.updatedAt || null,
  };
}

export const DELIVERY_DISCLAIMER_ES =
  "La modalidad de entrega depende del negocio y de la operacion activa en la ciudad.";
