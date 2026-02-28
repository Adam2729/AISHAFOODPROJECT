const DEFAULT_PUBLIC_NOTE_ES = "Entrega manejada por el negocio";

type DeliveryPolicyInput = {
  mode?: string | null;
  publicNoteEs?: string | null;
  courierName?: string | null;
  courierPhone?: string | null;
  instructionsEs?: string | null;
  updatedAt?: Date | string | null;
};

type BusinessWithDeliveryPolicy = {
  deliveryPolicy?: DeliveryPolicyInput | null;
};

export function getPublicDeliveryInfo(business: BusinessWithDeliveryPolicy) {
  const policy = business?.deliveryPolicy || {};
  const publicNoteEs = String(policy.publicNoteEs || "").trim() || DEFAULT_PUBLIC_NOTE_ES;
  return {
    mode: "self_delivery" as const,
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
  "Aisha Food no asigna repartidor. La entrega la maneja el negocio.";
