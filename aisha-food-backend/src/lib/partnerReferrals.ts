import mongoose from "mongoose";
import { Business } from "@/models/Business";
import { Driver } from "@/models/Driver";

const REFERRAL_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 6;

export const RESTAURANT_REFERRAL_PROMO_CREDITS = 10000;
export const DRIVER_REFERRAL_SIGNUP_BONUS = 5000;

function toObjectId(value: mongoose.Types.ObjectId | string) {
  return value instanceof mongoose.Types.ObjectId
    ? value
    : new mongoose.Types.ObjectId(String(value));
}

export function normalizePartnerReferralCode(value: unknown) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 24);
}

export function buildPartnerReferralAuditEntry(input: {
  applicationId: mongoose.Types.ObjectId | string;
  referredEntityId: mongoose.Types.ObjectId | string;
  referredByCode?: string | null;
  rewardAmount: number;
  kind: "referrer_credit" | "referred_signup";
  actor?: string;
}) {
  return {
    appliedAt: new Date(),
    applicationId: toObjectId(input.applicationId),
    referredEntityId: toObjectId(input.referredEntityId),
    referredByCode: normalizePartnerReferralCode(input.referredByCode),
    rewardAmount: Math.max(0, Number(input.rewardAmount || 0)),
    kind: input.kind,
    actor: String(input.actor || "admin_approval").trim().slice(0, 40) || "admin_approval",
  };
}

function buildCode(prefix: string) {
  let suffix = "";
  for (let index = 0; index < CODE_LENGTH; index += 1) {
    const nextIndex = Math.floor(Math.random() * REFERRAL_ALPHABET.length);
    suffix += REFERRAL_ALPHABET[nextIndex];
  }
  return `${prefix}${suffix}`;
}

export async function generateUniqueBusinessReferralCode() {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const candidate = buildCode("RST");
    const existing = await Business.findOne({ referralCode: candidate }).select("_id").lean();
    if (!existing) return candidate;
  }
  throw new Error("Could not generate restaurant referral code.");
}

export async function generateUniqueDriverReferralCode() {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const candidate = buildCode("DRV");
    const existing = await Driver.findOne({ referralCode: candidate }).select("_id").lean();
    if (!existing) return candidate;
  }
  throw new Error("Could not generate driver referral code.");
}

export async function findBusinessReferralOwner(input: {
  cityId: mongoose.Types.ObjectId | string;
  code: string;
}) {
  const cityId = toObjectId(input.cityId);
  const code = normalizePartnerReferralCode(input.code);
  if (!code) return null;
  return Business.findOne({
    cityId,
    referralCode: code,
  })
    .select("_id cityId name referralCode promotionCredits")
    .lean<{
      _id: mongoose.Types.ObjectId;
      cityId: mongoose.Types.ObjectId;
      name?: string;
      referralCode?: string | null;
      promotionCredits?: number | null;
    } | null>();
}

export async function findDriverReferralOwner(input: {
  cityId: mongoose.Types.ObjectId | string;
  code: string;
}) {
  const cityId = toObjectId(input.cityId);
  const code = normalizePartnerReferralCode(input.code);
  if (!code) return null;
  return Driver.findOne({
    cityId,
    referralCode: code,
  })
    .select("_id cityId name referralCode signupBonusAmount")
    .lean<{
      _id: mongoose.Types.ObjectId;
      cityId: mongoose.Types.ObjectId;
      name?: string;
      referralCode?: string | null;
      signupBonusAmount?: number | null;
    } | null>();
}
