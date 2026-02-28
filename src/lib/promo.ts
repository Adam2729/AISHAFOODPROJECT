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
