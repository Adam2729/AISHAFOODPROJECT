import mongoose from "mongoose";
import { dbConnect } from "@/lib/mongodb";
import { ok, fail } from "@/lib/apiResponse";
import { assertNotInMaintenance } from "@/lib/maintenance";
import { requireAdminKey } from "@/lib/adminAuth";
import { hashDriverPassword, normalizeDriverEmail } from "@/lib/driverCredentials";
import { createDriverSessionLink, generateTemporaryDriverPassword } from "@/lib/driverAdmin";
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
import { maskPhone } from "@/lib/pii";

type ApiError = Error & { status?: number; code?: string };

type DriverDoc = {
  _id: mongoose.Types.ObjectId;
  name?: string | null;
  email?: string | null;
  phoneE164?: string | null;
  phoneHash?: string | null;
  cityId?: mongoose.Types.ObjectId | null;
  zoneLabel?: string | null;
  vehicleType?: string | null;
  payout?: {
    preferredMethod?: string | null;
    accountName?: string | null;
    accountNumber?: string | null;
    notes?: string | null;
  } | null;
  isActive?: boolean;
  isBanned?: boolean;
  availability?: string | null;
  auth?: {
    passwordHash?: string | null;
  } | null;
};

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

async function findExistingDriverForApplication(input: {
  approvedDriverId?: mongoose.Types.ObjectId | string | null;
  driverId?: mongoose.Types.ObjectId | string | null;
  phoneHash: string;
  email: string;
}) {
  const or: Record<string, unknown>[] = [];
  const linkedId = String(input.approvedDriverId || input.driverId || "").trim();
  if (mongoose.Types.ObjectId.isValid(linkedId)) {
    or.push({ _id: new mongoose.Types.ObjectId(linkedId) });
  }
  if (input.phoneHash) {
    or.push({ phoneHash: input.phoneHash });
  }
  if (input.email) {
    or.push({ email: input.email });
  }
  if (!or.length) return null;

  return Driver.findOne({ $or: or })
    .select(
      "_id name email phoneE164 phoneHash cityId zoneLabel vehicleType payout isActive isBanned availability auth.passwordHash"
    )
    .lean<DriverDoc | null>();
}

async function ensureApprovedDriverAccount(input: {
  application: Record<string, unknown> & {
    _id: mongoose.Types.ObjectId;
    cityId: mongoose.Types.ObjectId;
  };
}) {
  const fullName = String(input.application.fullName || input.application.name || "").trim();
  const phoneE164 =
    normalizePhone(String(input.application.phone || "").trim()) ||
    String(input.application.phone || "").trim();
  const email = normalizeDriverEmail(input.application.email);
  const phoneHash = phoneToHash(phoneE164);
  const zoneLabel = String(input.application.zoneLabel || "").trim() || null;
  const vehicleType = String(input.application.vehicleType || "").trim() || null;
  const payoutMethod = String(input.application.payoutMethod || "").trim() || "cash";
  const payoutAccountName = String(input.application.payoutAccountName || "").trim() || "";
  const payoutAccountNumber = String(input.application.payoutAccountNumber || "").trim() || "";
  const payoutNotes = String(input.application.payoutNotes || "").trim() || "";
  const applicationPasswordHash = String(input.application.passwordHash || "").trim();

  const existing = await findExistingDriverForApplication({
    approvedDriverId: input.application.approvedDriverId as
      | mongoose.Types.ObjectId
      | string
      | null
      | undefined,
    driverId: input.application.driverId as mongoose.Types.ObjectId | string | null | undefined,
    phoneHash,
    email,
  });

  const shouldUseApplicationPasswordHash = Boolean(applicationPasswordHash);
  const shouldGenerateTemporaryPassword =
    !shouldUseApplicationPasswordHash && !existing?.auth?.passwordHash;
  const temporaryPassword = shouldGenerateTemporaryPassword
    ? generateTemporaryDriverPassword()
    : null;
  const passwordHash = shouldUseApplicationPasswordHash
    ? applicationPasswordHash
    : temporaryPassword
      ? hashDriverPassword(temporaryPassword)
      : String(existing?.auth?.passwordHash || "").trim() || null;

  let driverId = existing?._id || null;
  if (!driverId) {
    const created = await Driver.create({
      name: fullName,
      email: email || null,
      phoneE164: phoneE164 || null,
      phoneHash: phoneHash || "",
      cityId: input.application.cityId,
      isActive: true,
      isBanned: false,
      availability: "offline",
      zoneLabel,
      vehicleType,
      payout: {
        preferredMethod: payoutMethod,
        accountName: payoutAccountName,
        accountNumber: payoutAccountNumber,
        notes: payoutNotes,
      },
      referredByCode: normalizePartnerReferralCode(input.application.referredByCode),
      signupBonusAmount: 0,
      auth: passwordHash
        ? {
          passwordHash,
          passwordSetAt: new Date(),
          }
        : undefined,
    });
    driverId = created._id;
  } else {
    const update: Record<string, unknown> = {
      name: fullName,
      email: email || null,
      phoneE164: phoneE164 || null,
      phoneHash: phoneHash || "",
      cityId: input.application.cityId,
      isActive: true,
      isBanned: false,
      bannedAt: null,
      bannedReason: null,
      pausedAt: null,
      pausedReason: null,
      zoneLabel,
      vehicleType,
      payout: {
        preferredMethod: payoutMethod,
        accountName: payoutAccountName,
        accountNumber: payoutAccountNumber,
        notes: payoutNotes,
      },
    };
    if (passwordHash) {
      update["auth.passwordHash"] = passwordHash;
      update["auth.passwordSetAt"] = new Date();
    }
    await Driver.updateOne({ _id: driverId }, { $set: update });
  }

  const driver = await Driver.findById(driverId)
    .select(
      "_id name email phoneE164 phoneHash cityId zoneLabel vehicleType payout isActive isBanned availability auth.passwordHash"
    )
    .lean<DriverDoc | null>();
  if (!driver) {
    throw new Error("Driver account could not be created.");
  }

  const referralCode = await ensureDriverReferralCode(driver._id);
  return {
    driver,
    referralCode,
    temporaryPassword,
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

    const approval = await ensureApprovedDriverAccount({
      application: application as Record<string, unknown> & {
        _id: mongoose.Types.ObjectId;
        cityId: mongoose.Types.ObjectId;
      },
    });

    const idempotent = application.status === "approved";
    if (!idempotent) {
      const updated = await DriverApplication.findOneAndUpdate(
        { _id: application._id, status: "pending" },
        {
          $set: {
            status: "approved",
            reviewedAt: new Date(),
            reviewedBy: "admin_key",
            reviewedByAdminId: null,
            rejectReason: null,
            rejectionReason: null,
            driverId: approval.driver._id,
            approvedDriverId: approval.driver._id,
          },
        },
        { new: true }
      ).lean();
      if (!updated) {
        return fail("INVALID_STATE", "Application not pending.", 409);
      }
    } else {
      await DriverApplication.updateOne(
        { _id: application._id },
        {
          $set: {
            reviewedAt: application.reviewedAt || new Date(),
            reviewedBy: String((application as { reviewedBy?: string }).reviewedBy || "admin_key"),
            driverId: approval.driver._id,
            approvedDriverId: approval.driver._id,
          },
        }
      );
    }

    const referralBonus = await applyDriverReferralBonus({
      applicationId: application._id,
      cityId: application.cityId,
      driverId: approval.driver._id,
      referredByCode: (application as { referredByCode?: string }).referredByCode,
      alreadyAppliedAt: (application as { referralBonusAppliedAt?: Date | null }).referralBonusAppliedAt,
    });

    const sessionLink = await createDriverSessionLink({
      driverId: approval.driver._id,
      cityId: approval.driver.cityId || application.cityId,
      origin: new URL(req.url).origin,
      createdByAdminId: "admin_key",
    });

    return ok({
      applicationId: String(application._id),
      driverId: String(approval.driver._id),
      cityId: String(application.cityId),
      status: "approved",
      idempotent,
      referralCode: approval.referralCode,
      referralBonus,
      driver: {
        id: String(approval.driver._id),
        name: String(approval.driver.name || ""),
        email: String(approval.driver.email || ""),
        phoneMasked: maskPhone(String(approval.driver.phoneE164 || "").trim()),
        cityId: approval.driver.cityId ? String(approval.driver.cityId) : String(application.cityId),
        vehicleType: String(approval.driver.vehicleType || ""),
      },
      temporaryPassword: approval.temporaryPassword,
      loginLink: sessionLink.linkUrl,
      loginLinkExpiresAt: sessionLink.expiresAt,
      loginLinkWhatsappText: sessionLink.whatsappText,
    });
  } catch (error: unknown) {
    const err = error as ApiError;
    return fail(err.code || "SERVER_ERROR", err.message || "Could not approve driver application.", err.status || 500);
  }
}
