import mongoose from "mongoose";
import { roundCurrency } from "@/lib/money";
import { PROMO_CODE_MAX_LEN } from "@/lib/constants";

type PromoInput = {
  _id: mongoose.Types.ObjectId | string;
  code: string;
  type: "percentage" | "fixed";
  value: number;
  minSubtotal?: number;
  expiresAt?: Date | null;
  maxRedemptions?: number | null;
  perPhoneLimit?: number;
  businessAllowlist?: Array<mongoose.Types.ObjectId | string>;
  fundedBy?: "platform" | string;
  isActive?: boolean;
};

type ComputePromoArgs = {
  promo: PromoInput;
  subtotal: number;
  businessId: string;
  phoneHash: string;
  now: Date;
  redemptionCountForPromo: number;
  redemptionCountForPhone: number;
};

export function normalizePromoCode(code: string): string {
  const normalized = String(code || "").trim().toUpperCase();
  return normalized.slice(0, PROMO_CODE_MAX_LEN);
}

export function computePromoDiscount(args: ComputePromoArgs): {
  discountAmount: number;
  reason?: string;
} {
  const subtotal = roundCurrency(Number(args.subtotal || 0));
  if (!args.promo || !args.promo._id) return { discountAmount: 0, reason: "PROMO_NOT_FOUND" };
  if (!args.promo.isActive) return { discountAmount: 0, reason: "PROMO_INACTIVE" };
  if (String(args.promo.fundedBy || "platform") !== "platform") {
    return { discountAmount: 0, reason: "PROMO_NOT_SUPPORTED" };
  }

  const expiresAt = args.promo.expiresAt ? new Date(args.promo.expiresAt) : null;
  if (expiresAt && expiresAt.getTime() <= args.now.getTime()) {
    return { discountAmount: 0, reason: "PROMO_EXPIRED" };
  }

  const minSubtotal = Number(args.promo.minSubtotal || 0);
  if (subtotal < minSubtotal) return { discountAmount: 0, reason: "MIN_SUBTOTAL_NOT_MET" };

  const allowedBusinesses = Array.isArray(args.promo.businessAllowlist)
    ? args.promo.businessAllowlist.map((id) => String(id))
    : [];
  if (allowedBusinesses.length > 0 && !allowedBusinesses.includes(String(args.businessId))) {
    return { discountAmount: 0, reason: "BUSINESS_NOT_ELIGIBLE" };
  }

  const maxRedemptions = args.promo.maxRedemptions == null ? null : Number(args.promo.maxRedemptions);
  if (maxRedemptions != null && Number(args.redemptionCountForPromo || 0) >= maxRedemptions) {
    return { discountAmount: 0, reason: "PROMO_EXHAUSTED" };
  }

  const perPhoneLimit = Math.max(1, Number(args.promo.perPhoneLimit || 1));
  if (Number(args.redemptionCountForPhone || 0) >= perPhoneLimit) {
    return { discountAmount: 0, reason: "PHONE_LIMIT_REACHED" };
  }

  if (!args.phoneHash) return { discountAmount: 0, reason: "PHONE_REQUIRED" };

  let discountAmount = 0;
  if (args.promo.type === "percentage") {
    discountAmount = roundCurrency(subtotal * (Number(args.promo.value || 0) / 100));
  } else {
    discountAmount = roundCurrency(Number(args.promo.value || 0));
  }
  if (discountAmount <= 0) return { discountAmount: 0, reason: "DISCOUNT_INVALID" };

  discountAmount = roundCurrency(Math.min(discountAmount, subtotal));
  return { discountAmount };
}

type PromoCodeInput = {
  _id: mongoose.Types.ObjectId | string;
  code: string;
  cityId?: mongoose.Types.ObjectId | string | null;
  discountType: "percentage" | "flat";
  discountValue: number;
  maxDiscount?: number | null;
  minOrderAmount?: number | null;
  usageLimit?: number | null;
  usageCount?: number | null;
  isActive?: boolean;
  expiresAt?: Date | null;
};

type ComputePromoCodeArgs = {
  promoCode: PromoCodeInput;
  subtotal: number;
  now: Date;
};

export function computePromoCodeDiscount(args: ComputePromoCodeArgs): {
  discountAmount: number;
  finalSubtotal: number;
  reason?: string;
} {
  const subtotal = roundCurrency(Number(args.subtotal || 0));
  if (!args.promoCode || !args.promoCode._id) {
    return {
      discountAmount: 0,
      finalSubtotal: subtotal,
      reason: "PROMO_NOT_FOUND",
    };
  }
  if (!args.promoCode.isActive) {
    return {
      discountAmount: 0,
      finalSubtotal: subtotal,
      reason: "PROMO_INACTIVE",
    };
  }

  const expiresAt = args.promoCode.expiresAt ? new Date(args.promoCode.expiresAt) : null;
  if (expiresAt && expiresAt.getTime() <= args.now.getTime()) {
    return {
      discountAmount: 0,
      finalSubtotal: subtotal,
      reason: "PROMO_EXPIRED",
    };
  }

  const usageLimit =
    args.promoCode.usageLimit == null ? null : Math.max(0, Number(args.promoCode.usageLimit || 0));
  if (usageLimit != null && Number(args.promoCode.usageCount || 0) >= usageLimit) {
    return {
      discountAmount: 0,
      finalSubtotal: subtotal,
      reason: "PROMO_USAGE_LIMIT_REACHED",
    };
  }

  const minOrderAmount = Math.max(0, Number(args.promoCode.minOrderAmount || 0));
  if (subtotal < minOrderAmount) {
    return {
      discountAmount: 0,
      finalSubtotal: subtotal,
      reason: "MIN_ORDER_AMOUNT_NOT_MET",
    };
  }

  let discountAmount = 0;
  if (args.promoCode.discountType === "percentage") {
    discountAmount = roundCurrency(subtotal * (Number(args.promoCode.discountValue || 0) / 100));
  } else {
    discountAmount = roundCurrency(Number(args.promoCode.discountValue || 0));
  }

  const maxDiscount =
    args.promoCode.maxDiscount == null ? null : Math.max(0, Number(args.promoCode.maxDiscount || 0));
  if (maxDiscount != null && maxDiscount > 0) {
    discountAmount = Math.min(discountAmount, roundCurrency(maxDiscount));
  }

  discountAmount = roundCurrency(Math.max(0, Math.min(discountAmount, subtotal)));
  if (discountAmount <= 0) {
    return {
      discountAmount: 0,
      finalSubtotal: subtotal,
      reason: "DISCOUNT_INVALID",
    };
  }

  return {
    discountAmount,
    finalSubtotal: roundCurrency(subtotal - discountAmount),
  };
}

export function promoCodeReasonToMessage(reason?: string) {
  switch (reason) {
    case "PROMO_INACTIVE":
      return "This promo code is not active.";
    case "PROMO_EXPIRED":
      return "This promo code has expired.";
    case "PROMO_USAGE_LIMIT_REACHED":
      return "This promo code has reached its usage limit.";
    case "MIN_ORDER_AMOUNT_NOT_MET":
      return "This promo code requires a higher order subtotal.";
    case "PROMO_NOT_FOUND":
      return "Promo code not found.";
    default:
      return "Could not apply promo code.";
  }
}
