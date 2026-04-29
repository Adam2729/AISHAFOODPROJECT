import mongoose from "mongoose";
import { dbConnect } from "@/lib/mongodb";
import { ok, fail } from "@/lib/apiResponse";
import { assertNotInMaintenance } from "@/lib/maintenance";
import { requireAdminKey } from "@/lib/adminAuth";
import { getCityCenter, requireActiveCity } from "@/lib/city";
import { COMMISSION_RATE_DEFAULT, TRIAL_DAYS } from "@/lib/constants";
import {
  buildPartnerReferralAuditEntry,
  findBusinessReferralOwner,
  generateUniqueBusinessReferralCode,
  normalizePartnerReferralCode,
  RESTAURANT_REFERRAL_PROMO_CREDITS,
} from "@/lib/partnerReferrals";
import { getDefaultTimezoneForCity } from "@/lib/marketConfig";
import { getDefaultDeliveryPolicy } from "@/lib/deliveryPolicy";
import {
  mapMerchantTypeToBusinessType,
  normalizeDeliveryType,
  normalizeMerchantType,
  normalizePayoutMethod,
} from "@/lib/merchantOnboarding";
import { addDays } from "@/lib/subscription";
import { hashSecret } from "@/lib/password";
import { MerchantApplication } from "@/models/MerchantApplication";
import { Business } from "@/models/Business";
import { City } from "@/models/City";

type ApiError = Error & { status?: number; code?: string };

const ADMIN_ACTOR = "admin_key";

async function ensureBusinessReferralCode(businessId: mongoose.Types.ObjectId | string) {
  const business = await Business.findById(businessId)
    .select("_id referralCode")
    .lean<{ _id: mongoose.Types.ObjectId; referralCode?: string | null } | null>();
  if (!business) return "";
  const existingCode = normalizePartnerReferralCode(business.referralCode);
  if (existingCode) return existingCode;

  for (let attempt = 0; attempt < 10; attempt += 1) {
    const candidate = await generateUniqueBusinessReferralCode();
    const updated = await Business.findOneAndUpdate(
      {
        _id: business._id,
        $or: [
          { referralCode: null },
          { referralCode: "" },
          { referralCode: { $exists: false } },
        ],
      },
      { $set: { referralCode: candidate } },
      { new: true }
    )
      .select("_id referralCode")
      .lean<{ _id: mongoose.Types.ObjectId; referralCode?: string | null } | null>();

    const nextCode = normalizePartnerReferralCode(updated?.referralCode);
    if (nextCode) return nextCode;
  }

  return "";
}

async function applyMerchantReferralBonus(input: {
  applicationId: mongoose.Types.ObjectId | string;
  cityId: mongoose.Types.ObjectId | string;
  businessId: mongoose.Types.ObjectId | string;
  referredByCode?: string | null;
  alreadyAppliedAt?: Date | null;
}) {
  const code = normalizePartnerReferralCode(input.referredByCode);
  if (!code || input.alreadyAppliedAt) {
    return {
      applied: false,
      rewardAmount: 0,
    };
  }

  const referrer = await findBusinessReferralOwner({
    cityId: input.cityId,
    code,
  });
  if (!referrer || String(referrer._id) === String(input.businessId)) {
    return {
      applied: false,
      rewardAmount: 0,
    };
  }

  const rewardAmount = RESTAURANT_REFERRAL_PROMO_CREDITS;
  const marked = await MerchantApplication.findOneAndUpdate(
    {
      _id: input.applicationId,
      $or: [
        { referralBonusAppliedAt: null },
        { referralBonusAppliedAt: { $exists: false } },
      ],
    },
    {
      $set: {
        referralBonusAppliedAt: new Date(),
        referrerBusinessId: referrer._id,
        referralRewardAmount: rewardAmount,
      },
    },
    { new: true }
  )
    .select("_id")
    .lean();

  if (!marked) {
    return {
      applied: false,
      rewardAmount: 0,
      idempotent: true,
    };
  }

  await Promise.all([
    Business.updateOne(
      { _id: referrer._id },
      {
        $inc: { promotionCredits: rewardAmount },
        $push: {
          referralBonusAudit: buildPartnerReferralAuditEntry({
            applicationId: input.applicationId,
            referredEntityId: input.businessId,
            referredByCode: code,
            rewardAmount,
            kind: "referrer_credit",
          }),
        },
      }
    ),
    Business.updateOne(
      {
        _id: input.businessId,
        $or: [
          { referredByCode: null },
          { referredByCode: "" },
          { referredByCode: { $exists: false } },
        ],
      },
      {
        $set: { referredByCode: code },
        $push: {
          referralBonusAudit: buildPartnerReferralAuditEntry({
            applicationId: input.applicationId,
            referredEntityId: referrer._id,
            referredByCode: code,
            rewardAmount,
            kind: "referred_signup",
          }),
        },
      }
    ),
  ]);

  return {
    applied: true,
    rewardAmount,
    referrerBusinessId: String(referrer._id),
  };
}

export async function POST(
  req: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    requireAdminKey(req);
    await assertNotInMaintenance();
    await dbConnect();

    const { id } = await context.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return fail("VALIDATION_ERROR", "Valid application id is required.", 400);
    }

    const application = await MerchantApplication.findById(id).lean();
    if (!application) return fail("NOT_FOUND", "Application not found.", 404);

    if (application.status === "rejected") {
      return fail("INVALID_STATE", "Application already rejected; cannot approve.", 409);
    }

    if (application.status === "approved" && application.createdBusinessId) {
      const referralCode = await ensureBusinessReferralCode(application.createdBusinessId);
      const referralBonus = await applyMerchantReferralBonus({
        applicationId: application._id,
        cityId: application.cityId,
        businessId: application.createdBusinessId,
        referredByCode: (application as { referredByCode?: string }).referredByCode,
        alreadyAppliedAt: (application as { referralBonusAppliedAt?: Date | null }).referralBonusAppliedAt,
      });
      return ok({
        applicationId: String(application._id),
        businessId: String(application.createdBusinessId),
        referralCode,
        referralBonus,
        idempotent: true,
      });
    }

    // Transition pending/needs_info -> approved (idempotent-safe)
    if (application.status !== "approved") {
      const updated = await MerchantApplication.findOneAndUpdate(
        { _id: application._id, status: { $in: ["pending", "needs_info"] } },
        {
          $set: {
            status: "approved",
            approvedAt: new Date(),
            approvedByAdminId: ADMIN_ACTOR,
          },
        },
        { new: true }
      ).lean();

      if (!updated) {
        const refreshed = await MerchantApplication.findById(application._id).lean();
        if (refreshed?.status === "approved" && refreshed.createdBusinessId) {
          return ok({
            applicationId: String(refreshed._id),
            businessId: String(refreshed.createdBusinessId),
            idempotent: true,
          });
        }
        if (refreshed?.status === "rejected") {
          return fail("INVALID_STATE", "Application already rejected.", 409);
        }
        return fail("INVALID_STATE", "Could not approve application.", 409);
      }
      application.status = updated.status;
      application.approvedAt = updated.approvedAt;
      application.approvedByAdminId = updated.approvedByAdminId;
    }

    if (application.createdBusinessId) {
      return ok({
        applicationId: String(application._id),
        businessId: String(application.createdBusinessId),
        idempotent: true,
      });
    }

    const city = await City.findById(application.cityId).lean();
    if (!city) return fail("NOT_FOUND", "City not found for application.", 404);
    requireActiveCity({
      isActive: Boolean(city.isActive),
      code: String(city.code || ""),
      name: String(city.name || ""),
      country: String(city.country || ""),
    });

    const center = getCityCenter({
      coverageCenterLat: (city as { coverageCenterLat?: number }).coverageCenterLat,
      coverageCenterLng: (city as { coverageCenterLng?: number }).coverageCenterLng,
    });

    const now = new Date();
    const trialEndsAt = addDays(now, TRIAL_DAYS);
    const pin = String(Math.floor(100000 + Math.random() * 900000));
    const commissionRate = Number((city as { commissionRate?: number }).commissionRate);
    const referralCode = await generateUniqueBusinessReferralCode();
    const merchantType = normalizeMerchantType((application as { merchantType?: string }).merchantType);
    const deliveryType = normalizeDeliveryType(
      (application as { deliveryType?: string }).deliveryType
    );
    const passwordHash = String((application as { passwordHash?: string }).passwordHash || "").trim();
    const email =
      String((application as { email?: string }).email || "").trim().toLowerCase() || undefined;
    const prepMinutes = Math.max(
      5,
      Math.min(120, Number((application as { averagePrepMinutes?: number }).averagePrepMinutes || 15))
    );
    const deliveryRadiusKm = Math.max(
      1,
      Math.min(200, Number((application as { deliveryRadiusKm?: number }).deliveryRadiusKm || 8))
    );
    const payoutMethod = normalizePayoutMethod((application as { payoutMethod?: string }).payoutMethod);
    const deliveryPolicy = getDefaultDeliveryPolicy(deliveryType);

    const business = await Business.create({
      type: mapMerchantTypeToBusinessType(merchantType),
      merchantType,
      deliveryType,
      name: String(application.businessName || "").trim(),
      ownerName: String((application as { ownerName?: string }).ownerName || "").trim(),
      phone: String(application.phone || "").trim(),
      email,
      whatsapp: String(application.whatsapp || "").trim(),
      address: String(application.address || "").trim() || "Pending address",
      area: String((application as { area?: string }).area || "").trim(),
      zoneLabel: String((application as { area?: string }).area || "").trim() || null,
      logoUrl: String((application as { logoUrl?: string }).logoUrl || "").trim(),
      coverImageUrl: String((application as { coverImageUrl?: string }).coverImageUrl || "").trim(),
      cuisineType: String((application as { cuisineType?: string }).cuisineType || "").trim(),
      storeCategory: String((application as { storeCategory?: string }).storeCategory || "").trim(),
      minimumOrderAmount: Math.max(
        0,
        Number((application as { minimumOrderAmount?: number }).minimumOrderAmount || 0)
      ),
      deliveryRadiusKm,
      referralCode,
      referredByCode: normalizePartnerReferralCode((application as { referredByCode?: string }).referredByCode),
      promotionCredits: 0,
      location: { type: "Point", coordinates: [Number(center.lng) || 0, Number(center.lat) || 0] },
      cityId: application.cityId,
      isActive: true,
      paused: false,
      commissionRate: Number.isFinite(commissionRate) ? commissionRate : COMMISSION_RATE_DEFAULT,
      eta: {
        minMins: Math.max(prepMinutes + 10, 20),
        maxMins: Math.max(prepMinutes + 25, 35),
        prepMins: prepMinutes,
      },
      payout: {
        preferredMethod: payoutMethod,
        details: String((application as { payoutDetails?: string }).payoutDetails || "").trim(),
        payoutContactName: String((application as { ownerName?: string }).ownerName || "").trim(),
      },
      deliveryPolicy: {
        mode: deliveryPolicy.mode,
        publicNoteEs: deliveryPolicy.publicNoteEs,
        updatedAt: now,
      },
      hours: {
        timezone: getDefaultTimezoneForCity(city),
      },
      auth: { pinHash: passwordHash || hashSecret(pin), mustChange: !passwordHash },
      subscription: {
        status: "trial",
        trialDays: TRIAL_DAYS,
        graceDays: 14,
        trialStartedAt: now,
        trialEndsAt,
        lastPaidAt: null,
        paidUntilAt: null,
      },
    });

    await MerchantApplication.updateOne(
      { _id: application._id },
      { $set: { createdBusinessId: business._id } }
    );

    const referralBonus = await applyMerchantReferralBonus({
      applicationId: application._id,
      cityId: application.cityId,
      businessId: business._id,
      referredByCode: (application as { referredByCode?: string }).referredByCode,
      alreadyAppliedAt: (application as { referralBonusAppliedAt?: Date | null }).referralBonusAppliedAt,
    });

    return ok({
      applicationId: String(application._id),
      businessId: String(business._id),
      referralCode,
      referralBonus,
      loginIdentifier: email || String(business._id),
      temporaryPin: passwordHash ? null : pin,
    });
  } catch (error: unknown) {
    const err = error as ApiError;
    return fail(err.code || "SERVER_ERROR", err.message || "Could not approve application.", err.status || 500);
  }
}
