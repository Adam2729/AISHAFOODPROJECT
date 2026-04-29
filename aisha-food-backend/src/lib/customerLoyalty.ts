import mongoose from "mongoose";
import { REFERRAL_REFERRER_BONUS_RDP } from "@/lib/constants";
import { getCityByIdOrDefault, normalizeMoneyCurrency } from "@/lib/city";
import { dbConnect } from "@/lib/mongodb";
import { roundCurrency } from "@/lib/money";
import { Customer } from "@/models/Customer";
import { CustomerLoyalty } from "@/models/CustomerLoyalty";
import { LoyaltyEvent } from "@/models/LoyaltyEvent";
import { PaymentEvent } from "@/models/PaymentEvent";
import { Referral } from "@/models/Referral";
import { Wallet } from "@/models/Wallet";

type LoyaltyLean = {
  _id: mongoose.Types.ObjectId;
  cityId: mongoose.Types.ObjectId;
  phoneHash: string;
  points?: number;
  lifetimeOrders?: number;
  lifetimeSpend?: number;
  referralCode?: string | null;
  referredByCode?: string | null;
  isActive?: boolean;
};

type LegacyCustomerLean = {
  _id: mongoose.Types.ObjectId;
  phoneHash: string;
  referralCode?: string | null;
};

const REFERRAL_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function toObjectId(value: mongoose.Types.ObjectId | string) {
  return value instanceof mongoose.Types.ObjectId
    ? value
    : new mongoose.Types.ObjectId(String(value));
}

function normalizePhoneHash(value: unknown) {
  return String(value || "").trim();
}

function normalizeReferralCode(value: unknown) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 24);
}

function normalizeNotes(value: unknown, maxLength = 280) {
  return String(value || "").trim().slice(0, maxLength) || null;
}

function isDuplicateKeyError(error: unknown) {
  const code = String((error as { code?: number | string })?.code || "");
  const message = String((error as { message?: string })?.message || "");
  return code === "11000" || /E11000/.test(message);
}

async function updateLegacyCustomerReferralCode(phoneHash: string, referralCode: string) {
  await Customer.updateOne(
    {
      phoneHash,
      referralCode: { $in: [null, ""] },
    },
    {
      $set: { referralCode },
    }
  ).catch(() => null);
}

async function buildCandidateReferralCode(phoneHash: string) {
  const legacyCustomer = await Customer.findOne({ phoneHash })
    .select("_id phoneHash referralCode")
    .lean<LegacyCustomerLean | null>();
  const legacyCode = normalizeReferralCode(legacyCustomer?.referralCode);
  if (legacyCode) {
    const taken = await CustomerLoyalty.findOne({ referralCode: legacyCode })
      .select("_id phoneHash cityId")
      .lean<{ _id: mongoose.Types.ObjectId; phoneHash: string; cityId: mongoose.Types.ObjectId } | null>();
    if (!taken || String(taken.phoneHash) === phoneHash) {
      return legacyCode;
    }
  }
  return "";
}

export function generateReferralCode() {
  let code = "";
  for (let index = 0; index < 8; index += 1) {
    const nextIndex = Math.floor(Math.random() * REFERRAL_CODE_ALPHABET.length);
    code += REFERRAL_CODE_ALPHABET[nextIndex];
  }
  return code;
}

export async function getOrCreateCustomerLoyalty(input: {
  cityId: mongoose.Types.ObjectId | string;
  phoneHash: string;
}) {
  await dbConnect();
  const cityId = toObjectId(input.cityId);
  const phoneHash = normalizePhoneHash(input.phoneHash);
  if (!phoneHash) {
    throw new Error("phoneHash is required.");
  }

  let existing = await CustomerLoyalty.findOne({
    cityId,
    phoneHash,
  }).lean<LoyaltyLean | null>();
  if (existing?.referralCode) {
    return existing;
  }

  for (let attempt = 0; attempt < 10; attempt += 1) {
    const candidate =
      (attempt === 0 ? await buildCandidateReferralCode(phoneHash) : "") || generateReferralCode();
    try {
      if (!existing) {
        const created = await CustomerLoyalty.create({
          cityId,
          phoneHash,
          points: 0,
          lifetimeOrders: 0,
          lifetimeSpend: 0,
          referralCode: candidate,
          referredByCode: null,
          isActive: true,
        });
        await updateLegacyCustomerReferralCode(phoneHash, candidate);
        return created.toObject() as LoyaltyLean;
      }

      const updated = await CustomerLoyalty.findOneAndUpdate(
        {
          _id: existing._id,
          cityId,
          phoneHash,
          $or: [
            { referralCode: null },
            { referralCode: { $exists: false } },
            { referralCode: "" },
          ],
        },
        {
          $set: {
            referralCode: candidate,
            isActive: true,
          },
        },
        { returnDocument: "after" }
      ).lean<LoyaltyLean | null>();

      if (updated?.referralCode) {
        await updateLegacyCustomerReferralCode(phoneHash, candidate);
        return updated;
      }

      existing = await CustomerLoyalty.findOne({
        cityId,
        phoneHash,
      }).lean<LoyaltyLean | null>();
      if (existing?.referralCode) {
        return existing;
      }
    } catch (error: unknown) {
      if (!isDuplicateKeyError(error)) {
        throw error;
      }
      existing = await CustomerLoyalty.findOne({
        cityId,
        phoneHash,
      }).lean<LoyaltyLean | null>();
      if (existing?.referralCode) {
        return existing;
      }
    }
  }

  throw new Error("Could not assign referral code.");
}

export async function findReferralOwnerByCode(input: {
  cityId: mongoose.Types.ObjectId | string;
  code: string;
}) {
  await dbConnect();
  const cityId = toObjectId(input.cityId);
  const code = normalizeReferralCode(input.code);
  if (!code) return null;

  const anyLoyalty = await CustomerLoyalty.findOne({
    referralCode: code,
    isActive: true,
  }).lean<LoyaltyLean | null>();
  if (anyLoyalty) {
    if (String(anyLoyalty.cityId) !== String(cityId)) return null;
    return anyLoyalty;
  }

  const legacyCustomer = await Customer.findOne({ referralCode: code })
    .select("_id phoneHash referralCode")
    .lean<LegacyCustomerLean | null>();
  if (!legacyCustomer?.phoneHash) return null;

  const loyalty = await getOrCreateCustomerLoyalty({
    cityId,
    phoneHash: legacyCustomer.phoneHash,
  });
  if (normalizeReferralCode(loyalty.referralCode) !== code) {
    return null;
  }
  return loyalty;
}

export async function awardOrderLoyalty(input: {
  cityId: mongoose.Types.ObjectId | string;
  phoneHash: string;
  orderId: mongoose.Types.ObjectId | string;
  orderTotal: number;
}) {
  await dbConnect();
  const cityId = toObjectId(input.cityId);
  const orderId = toObjectId(input.orderId);
  const phoneHash = normalizePhoneHash(input.phoneHash);
  const safeTotal = roundCurrency(Math.max(0, Number(input.orderTotal || 0)));
  const pointsAwarded = Math.max(0, Math.floor(safeTotal / 100));

  const existingEvent = await LoyaltyEvent.findOne({
    cityId,
    phoneHash,
    orderId,
    eventType: "order_points",
  })
    .select("_id points walletAmount")
    .lean<{ _id: mongoose.Types.ObjectId; points?: number | null } | null>();
  if (existingEvent) {
    return {
      pointsAwarded: Number(existingEvent.points || 0),
      idempotent: true,
    };
  }

  const loyalty = await getOrCreateCustomerLoyalty({ cityId, phoneHash });
  await CustomerLoyalty.updateOne(
    { _id: loyalty._id, cityId, phoneHash },
    {
      $inc: {
        points: pointsAwarded,
        lifetimeOrders: 1,
        lifetimeSpend: safeTotal,
      },
      $set: {
        isActive: true,
      },
    }
  );

  await LoyaltyEvent.create({
    cityId,
    phoneHash,
    eventType: "order_points",
    points: pointsAwarded,
    walletAmount: 0,
    orderId,
    referralId: null,
    notes: `Order loyalty awarded on delivered order ${String(orderId)}`,
  });

  return {
    pointsAwarded,
    idempotent: false,
  };
}

export async function applyReferralReward(input: {
  cityId: mongoose.Types.ObjectId | string;
  referrerCode: string;
  referredPhoneHash: string;
  orderId: mongoose.Types.ObjectId | string;
}) {
  await dbConnect();
  const cityId = toObjectId(input.cityId);
  const orderId = toObjectId(input.orderId);
  const referrerCode = normalizeReferralCode(input.referrerCode);
  const referredPhoneHash = normalizePhoneHash(input.referredPhoneHash);

  if (!referrerCode || !referredPhoneHash) {
    return {
      rewarded: false,
      reason: "MISSING_REFERRAL_CONTEXT",
    };
  }

  const referrer = await findReferralOwnerByCode({ cityId, code: referrerCode });
  if (!referrer?.phoneHash) {
    return {
      rewarded: false,
      reason: "INVALID_REFERRAL_CODE",
    };
  }
  if (referrer.phoneHash === referredPhoneHash) {
    return {
      rewarded: false,
      reason: "SELF_REFERRAL",
    };
  }

  const existingRewardEvent = await LoyaltyEvent.findOne({
    cityId,
    phoneHash: referrer.phoneHash,
    orderId,
    eventType: "referral_reward",
  })
    .select("_id walletAmount points referralId")
    .lean<{
      _id: mongoose.Types.ObjectId;
      walletAmount?: number | null;
      points?: number | null;
      referralId?: mongoose.Types.ObjectId | null;
    } | null>();
  if (existingRewardEvent) {
    return {
      rewarded: true,
      idempotent: true,
      walletAmount: Number(existingRewardEvent.walletAmount || 0),
      pointsAwarded: Number(existingRewardEvent.points || 0),
    };
  }

  const referral = await Referral.findOne({
    cityId,
    referredPhoneHash,
  })
    .sort({ createdAt: 1, _id: 1 })
    .lean<{
      _id: mongoose.Types.ObjectId;
      referrerPhoneHash: string;
      rewardAmount?: number | null;
      status?: string | null;
      orderId?: mongoose.Types.ObjectId | null;
    } | null>();

  if (
    referral?.status === "earned" &&
    referral.orderId &&
    String(referral.orderId) !== String(orderId)
  ) {
    return {
      rewarded: false,
      reason: "ALREADY_REWARDED",
    };
  }
  if (
    referral?.status === "earned" &&
    referral.orderId &&
    String(referral.orderId) === String(orderId)
  ) {
    return {
      rewarded: true,
      idempotent: true,
      walletAmount: Number(referral.rewardAmount || 0),
      pointsAwarded: Math.max(0, Math.floor(Number(referral.rewardAmount || 0) / 100)),
    };
  }

  const rewardAmount = roundCurrency(
    Math.max(0, Number(referral?.rewardAmount || REFERRAL_REFERRER_BONUS_RDP || 0))
  );
  const pointsAwarded = Math.max(0, Math.floor(rewardAmount / 100));
  const city = await getCityByIdOrDefault(cityId);
  const referrerLoyalty = await getOrCreateCustomerLoyalty({
    cityId,
    phoneHash: referrer.phoneHash,
  });
  const referredLoyalty = await getOrCreateCustomerLoyalty({
    cityId,
    phoneHash: referredPhoneHash,
  });

  if (!normalizeReferralCode(referredLoyalty.referredByCode)) {
    await CustomerLoyalty.updateOne(
      { _id: referredLoyalty._id, cityId, phoneHash: referredPhoneHash },
      { $set: { referredByCode: referrerCode } }
    );
  }

  if (rewardAmount > 0) {
    await Wallet.findOneAndUpdate(
      {
        phoneHash: referrer.phoneHash,
        cityId,
      },
      {
        $setOnInsert: {
          phoneHash: referrer.phoneHash,
          cityId,
          currency: normalizeMoneyCurrency(city),
          isActive: true,
        },
        $inc: {
          balance: rewardAmount,
        },
      },
      { upsert: true }
    );
  }

  if (pointsAwarded > 0) {
    await CustomerLoyalty.updateOne(
      { _id: referrerLoyalty._id, cityId, phoneHash: referrer.phoneHash },
      {
        $inc: { points: pointsAwarded },
        $set: { isActive: true },
      }
    );
  }

  const referralWrite = await Referral.findOneAndUpdate(
    {
      cityId,
      referredPhoneHash,
    },
    {
      $setOnInsert: {
        cityId,
        referrerPhoneHash: referrer.phoneHash,
        referredPhoneHash,
        rewardAmount,
      },
      $set: {
        status: "earned",
        orderId,
        rewardAmount,
        referrerPhoneHash: referrer.phoneHash,
      },
    },
    {
      upsert: true,
      returnDocument: "after",
    }
  ).lean<{ _id: mongoose.Types.ObjectId } | null>();

  if (rewardAmount > 0) {
    await PaymentEvent.create({
      orderId,
      cityId,
      method: "wallet",
      status: "authorized",
      amount: rewardAmount,
      provider: "referral_reward",
      reference: `referral:${String(referralWrite?._id || "")}`,
      notes: `Referral reward credited for code ${referrerCode}`,
      createdBy: "system",
    });
  }

  await LoyaltyEvent.create({
    cityId,
    phoneHash: referrer.phoneHash,
    eventType: "referral_reward",
    points: pointsAwarded,
    walletAmount: rewardAmount,
    orderId,
    referralId: referralWrite?._id || null,
    notes: normalizeNotes(`Referral reward credited for code ${referrerCode}`),
  });

  return {
    rewarded: true,
    idempotent: false,
    walletAmount: rewardAmount,
    pointsAwarded,
  };
}
