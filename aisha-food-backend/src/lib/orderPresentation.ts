import { normalizePaymentMethod, normalizePaymentStatus, paymentMethodLabel } from "@/lib/payment";

type DeliveryProofLike = {
  required?: boolean | null;
  verifiedAt?: string | Date | null;
  verifiedBy?: "customer_code" | "admin_override" | string | null;
  failedAttempts?: number | null;
  otpLast4?: string | null;
};

type PaymentLike = {
  method?: string | null;
  status?: string | null;
};

function normalize(value: unknown) {
  return String(value || "").trim();
}

export function hasOtpFailure(deliveryProof?: DeliveryProofLike | null) {
  return Number(deliveryProof?.failedAttempts || 0) > 0;
}

export function isDeliveryConfirmed(
  orderStatus: string,
  deliveryProof?: DeliveryProofLike | null
) {
  const normalizedStatus = normalize(orderStatus).toLowerCase();
  return (
    normalizedStatus === "delivered" ||
    Boolean(deliveryProof?.verifiedAt) ||
    deliveryProof?.verifiedBy === "admin_override" ||
    deliveryProof?.required === false
  );
}

export function getMerchantDeliveryFinalizationLabel(
  orderStatus: string,
  deliveryProof?: DeliveryProofLike | null
) {
  if (isDeliveryConfirmed(orderStatus, deliveryProof)) return "Delivery confirmed";
  if (hasOtpFailure(deliveryProof)) return "OTP failed - retry or fallback";
  return "Waiting for customer OTP";
}

export function getMerchantDeliveryVerificationLabel(
  orderStatus: string,
  deliveryProof?: DeliveryProofLike | null
) {
  if (!isDeliveryConfirmed(orderStatus, deliveryProof)) return null;
  if (deliveryProof?.verifiedAt || deliveryProof?.verifiedBy === "customer_code") {
    return "OTP verified";
  }
  return "Delivery confirmed";
}

export function getMaskedOtpLast4(otpLast4?: string | null) {
  const safeLast4 = normalize(otpLast4).slice(-4);
  return safeLast4 ? `*** ${safeLast4}` : "-";
}

export function getMerchantPaymentMethodLabel(payment?: PaymentLike | null) {
  return paymentMethodLabel(payment?.method || "cash");
}

export function getMerchantPaymentStatusLabel(
  payment: PaymentLike | null | undefined,
  orderStatus: string
) {
  const normalizedStatus = normalizePaymentStatus(payment?.status || "pending");
  const normalizedMethod = normalizePaymentMethod(payment?.method || "cash");
  const normalizedOrderStatus = normalize(orderStatus).toLowerCase();

  if (normalizedMethod === "cash" && normalizedStatus === "paid") return "Cash received";
  if (normalizedStatus === "paid") return "Paid";
  if (normalizedStatus === "authorized") return "Authorized";
  if (normalizedStatus === "failed") return "Failed";
  if (normalizedStatus === "refunded") return "Refunded";

  if (normalizedMethod === "cash") {
    if (normalizedOrderStatus === "delivered") {
      return "Awaiting cash confirmation";
    }
    return "Cash due on delivery";
  }

  return "Pending";
}
