import mongoose from "mongoose";
import { dbConnect } from "@/lib/mongodb";
import { ok, fail } from "@/lib/apiResponse";
import { assertNotInMaintenance } from "@/lib/maintenance";
import { requireAdminKey } from "@/lib/adminAuth";
import {
  DRIVER_REFERRAL_SIGNUP_BONUS,
  buildPartnerReferralAuditEntry,
  findDriverReferralOwner,
  generateUniqueDriverReferralCode,
  normalizePartnerReferralCode,
} from "@/lib/partnerReferrals";
import { DriverApplication } from "@/models/DriverApplication";
import { Driver } from "@/models/Driver";
import { phoneToHash, normalizePhone } from "@/lib/phoneHash";

type ApiError = Error & { status?: number; code?: string };

async function ensureDriverReferralCode(driverId: mongoose.Types.ObjectId | string) {
  const driver = await Driver.findById(driverId)
    .select("_id referralCode")
    .lean<{ _id: mongoose.Types.ObjectId; referralCode?: string | null } | null>();
  if (!driver) return "";
  const existingCode = normalizePartnerReferralCode(driver.referralCode);
  if (existingCode) return existingCode;

  for (let attempt = 0; attempt < 10; attempt += 1) {
    const candidate = await generateUniqueDriverReferralCode();
    const updated = await Driver.findOneAndUpdate(
      {
        _id: driver._id,
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

async function applyDriverReferralBonus(input: {
  applicationId: mongoose.Types.ObjectId | string;
  cityId: mongoose.Types.ObjectId | string;
  driverId: mongoose.Types.ObjectId | string;
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

  const referrer = await findDriverReferralOwner({
    cityId: input.cityId,
    code,
  });
  if (!referrer || String(referrer._id) === String(input.driverId)) {
    return {
      applied: false,
      rewardAmount: 0,
    };
  }

  const rewardAmount = DRIVER_REFERRAL_SIGNUP_BONUS;
  const marked = await DriverApplication.findOneAndUpdate(
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
        referrerDriverId: referrer._id,
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
    Driver.updateOne(
      { _id: referrer._id },
      {
        $inc: { signupBonusAmount: rewardAmount },
        $push: {
          referralBonusAudit: buildPartnerReferralAuditEntry({
            applicationId: input.applicationId,
            referredEntityId: input.driverId,
            referredByCode: code,
            rewardAmount,
            kind: "referrer_credit",
          }),
        },
      }
    ),
    Driver.updateOne(
      {
        _id: input.driverId,
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
    referrerDriverId: String(referrer._id),
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

    const application = await DriverApplication.findById(id).lean();
    if (!application) return fail("NOT_FOUND", "Application not found.", 404);

    if (application.status === "rejected") {
      return fail("INVALID_STATE", "Application already rejected.", 409);
    }
    if (application.status === "approved" && application.driverId) {
      const referralCode = await ensureDriverReferralCode(application.driverId);
      const referralBonus = await applyDriverReferralBonus({
        applicationId: application._id,
        cityId: application.cityId,
        driverId: application.driverId,
        referredByCode: (application as { referredByCode?: string }).referredByCode,
        alreadyAppliedAt: (application as { referralBonusAppliedAt?: Date | null }).referralBonusAppliedAt,
      });
      return ok({
        applicationId: String(application._id),
        driverId: String(application.driverId),
        status: "approved",
        referralCode,
        referralBonus,
        idempotent: true,
      });
    }

    const updated = await DriverApplication.findOneAndUpdate(
      { _id: application._id, status: "pending" },
      {
        $set: {
          status: "approved",
          reviewedAt: new Date(),
          reviewedByAdminId: null,
        },
      },
      { new: true }
    ).lean();
    if (!updated) {
      return fail("INVALID_STATE", "Application not pending.", 409);
    }

    const phoneE164 = normalizePhone(String(application.phone || "").trim()) || String(application.phone || "").trim();
    const phoneHash = phoneToHash(phoneE164);
    const referralCode = await generateUniqueDriverReferralCode();

    const driver = await Driver.create({
      name: String(application.name || "").trim(),
      phoneE164,
      phoneHash: phoneHash || "",
      cityId: application.cityId,
      isActive: true,
      zoneLabel: String(application.zoneLabel || "").trim() || null,
      vehicleType: String((application as { vehicleType?: string }).vehicleType || "").trim() || null,
      referralCode,
      referredByCode: normalizePartnerReferralCode(
        (application as { referredByCode?: string }).referredByCode
      ),
      signupBonusAmount: 0,
    });

    await DriverApplication.updateOne(
      { _id: application._id },
      { $set: { driverId: driver._id } }
    );

    const referralBonus = await applyDriverReferralBonus({
      applicationId: application._id,
      cityId: application.cityId,
      driverId: driver._id,
      referredByCode: (application as { referredByCode?: string }).referredByCode,
      alreadyAppliedAt: (application as { referralBonusAppliedAt?: Date | null }).referralBonusAppliedAt,
    });

    return ok({
      applicationId: String(application._id),
      driverId: String(driver._id),
      cityId: String(application.cityId),
      status: "approved",
      referralCode,
      referralBonus,
    });
  } catch (error: unknown) {
    const err = error as ApiError;
    return fail(err.code || "SERVER_ERROR", err.message || "Could not approve driver application.", err.status || 500);
  }
}
