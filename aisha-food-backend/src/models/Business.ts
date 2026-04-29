import { Schema, model, models } from "mongoose";
import { COMMISSION_RATE_DEFAULT, GRACE_DAYS, TRIAL_DAYS } from "@/lib/constants";
import { getDefaultTimezoneForCity } from "@/lib/marketConfig";
import { ACTIVE_MERCHANT_TYPES, DELIVERY_TYPES, PAYOUT_METHODS } from "@/lib/merchantOnboarding";
import { addDays } from "@/lib/subscription";

const BusinessSchema = new Schema(
  {
    cityId: { type: Schema.Types.ObjectId, ref: "City", default: null, index: true },
    type: { type: String, enum: ["restaurant", "colmado"], required: true, index: true },
    merchantType: {
      type: String,
      enum: ACTIVE_MERCHANT_TYPES,
      default: "restaurant",
      index: true,
    },
    deliveryType: {
      type: String,
      enum: DELIVERY_TYPES,
      default: "own_driver",
      index: true,
    },
    name: { type: String, required: true, trim: true, index: true },
    ownerName: { type: String, default: "", trim: true, maxlength: 120 },
    phone: { type: String, required: true, trim: true },
    email: { type: String, default: undefined, trim: true, lowercase: true, maxlength: 160 },
    whatsapp: { type: String, default: "", trim: true },
    address: { type: String, required: true, trim: true },
    area: { type: String, default: "", trim: true, maxlength: 120 },
    zoneLabel: { type: String, default: null, trim: true, maxlength: 80, index: true },
    logoUrl: { type: String, default: "" },
    coverImageUrl: { type: String, default: "" },
    cuisineType: { type: String, default: "", trim: true, maxlength: 80 },
    storeCategory: { type: String, default: "", trim: true, maxlength: 80 },
    minimumOrderAmount: { type: Number, default: 0, min: 0 },
    deliveryRadiusKm: { type: Number, default: 8, min: 0, max: 200 },
    autoAcceptOrders: { type: Boolean, default: false },
    referralCode: {
      type: String,
      default: null,
      trim: true,
      uppercase: true,
      maxlength: 24,
    },
    referredByCode: {
      type: String,
      default: null,
      trim: true,
      uppercase: true,
      maxlength: 24,
    },
    promotionCredits: { type: Number, default: 0, min: 0 },
    referralBonusAudit: {
      type: [
        new Schema(
          {
            appliedAt: { type: Date, default: Date.now },
            applicationId: { type: Schema.Types.ObjectId, ref: "MerchantApplication", default: null },
            referredEntityId: { type: Schema.Types.ObjectId, ref: "Business", default: null },
            referredByCode: { type: String, default: null, trim: true, uppercase: true, maxlength: 24 },
            rewardAmount: { type: Number, default: 0, min: 0 },
            kind: {
              type: String,
              enum: ["referrer_credit", "referred_signup"],
              default: "referrer_credit",
            },
            actor: { type: String, default: "system", trim: true, maxlength: 40 },
          },
          { _id: false }
        ),
      ],
      default: [],
    },
    location: {
      type: {
        type: String,
        enum: ["Point"],
        default: "Point",
      },
      coordinates: {
        type: [Number], // [lng, lat]
        required: true,
      },
    },
    isActive: { type: Boolean, default: true, index: true },
    isDemo: { type: Boolean, default: false, index: true },
    paused: { type: Boolean, default: false, index: true },
    pausedReason: { type: String, default: "", trim: true, maxlength: 140 },
    pausedAt: { type: Date, default: null },
    isManuallyPaused: { type: Boolean, default: false, index: true },
    busyUntil: { type: Date, default: null },
    eta: {
      minMins: { type: Number, default: 25, min: 5, max: 180 },
      maxMins: { type: Number, default: 40, min: 5, max: 240 },
      prepMins: { type: Number, default: 15, min: 0, max: 120 },
    },
    payout: {
      preferredMethod: {
        type: String,
        enum: PAYOUT_METHODS,
        default: "cash_collection",
      },
      details: { type: String, default: "", trim: true, maxlength: 400 },
      payoutContactName: { type: String, default: "", trim: true, maxlength: 120 },
    },
    deliveryPolicy: {
      mode: {
        type: String,
        enum: ["self_delivery", "platform_driver"],
        default: "self_delivery",
      },
      courierName: { type: String, default: "", trim: true, maxlength: 60 },
      courierPhone: { type: String, default: "", trim: true, maxlength: 30 },
      publicNoteEs: { type: String, default: "", trim: true, maxlength: 120 },
      instructionsEs: { type: String, default: "", trim: true, maxlength: 280 },
      updatedAt: { type: Date, default: null },
    },
    menuQuality: {
      productsTotalCount: { type: Number, default: 0 },
      productsActiveCount: { type: Number, default: 0 },
      productsWithImageCount: { type: Number, default: 0 },
      categoriesCount: { type: Number, default: 0 },
      hasMinProducts: { type: Boolean, default: false },
      score: { type: Number, default: 0, min: 0, max: 100, index: true },
      updatedAt: { type: Date, default: null },
    },
    hours: {
      timezone: { type: String, default: () => getDefaultTimezoneForCity() },
      weekly: {
        mon: {
          open: { type: String, default: "08:00" },
          close: { type: String, default: "22:00" },
          closed: { type: Boolean, default: false },
        },
        tue: {
          open: { type: String, default: "08:00" },
          close: { type: String, default: "22:00" },
          closed: { type: Boolean, default: false },
        },
        wed: {
          open: { type: String, default: "08:00" },
          close: { type: String, default: "22:00" },
          closed: { type: Boolean, default: false },
        },
        thu: {
          open: { type: String, default: "08:00" },
          close: { type: String, default: "22:00" },
          closed: { type: Boolean, default: false },
        },
        fri: {
          open: { type: String, default: "08:00" },
          close: { type: String, default: "22:00" },
          closed: { type: Boolean, default: false },
        },
        sat: {
          open: { type: String, default: "08:00" },
          close: { type: String, default: "22:00" },
          closed: { type: Boolean, default: false },
        },
        sun: {
          open: { type: String, default: "08:00" },
          close: { type: String, default: "22:00" },
          closed: { type: Boolean, default: false },
        },
      },
    },
    commissionRate: { type: Number, default: COMMISSION_RATE_DEFAULT },
    health: {
      complaintsCount: { type: Number, default: 0 },
      cancelsCount30d: { type: Number, default: 0 },
      slowAcceptCount30d: { type: Number, default: 0 },
      lastHealthUpdateAt: { type: Date, default: null },
      lastHealthResetAt: { type: Date, default: null },
    },
    performance: {
      score: { type: Number, default: 50 },
      tier: {
        type: String,
        enum: ["gold", "silver", "bronze", "probation"],
        default: "bronze",
      },
      updatedAt: { type: Date, default: null },
      overrideBoost: { type: Number, default: 0 },
      overrideTier: {
        type: String,
        enum: ["gold", "silver", "bronze", "probation", null],
        default: null,
      },
      note: { type: String, default: null, trim: true, maxlength: 200 },
    },
    auth: {
      pinHash: { type: String, required: true },
      mustChange: { type: Boolean, default: false },
    },
    subscription: {
      status: { type: String, enum: ["trial", "active", "past_due", "suspended"], default: "trial" },
      trialDays: { type: Number, default: TRIAL_DAYS },
      graceDays: { type: Number, default: GRACE_DAYS },
      trialStartedAt: { type: Date, default: Date.now },
      trialEndsAt: { type: Date, default: () => addDays(new Date(), TRIAL_DAYS) },
      lastPaidAt: { type: Date, default: null },
      paidUntilAt: { type: Date, default: null },
    },
  },
  { timestamps: true }
);

BusinessSchema.index({ location: "2dsphere" });
BusinessSchema.index({ cityId: 1, isActive: 1, createdAt: -1 });
BusinessSchema.index({ "performance.tier": 1, "performance.score": -1, updatedAt: -1 });
BusinessSchema.index({ "menuQuality.score": -1, updatedAt: -1 });
BusinessSchema.index({ name: "text" }, { name: "business_text_idx", weights: { name: 10 } });
BusinessSchema.index({ referralCode: 1 }, { unique: true, sparse: true });
BusinessSchema.index({ email: 1 }, { unique: true, sparse: true });

const existingBusinessModel = models.Business;
if (existingBusinessModel) {
  const existingSchema = existingBusinessModel.schema as Schema & {
    __businessSchemaMerged?: boolean;
    add?: (obj: Record<string, unknown>) => unknown;
    path?: (name: string) => unknown;
  };
  const needsDeliveryPolicyMerge = !existingSchema.path?.("deliveryPolicy");
  const needsCityIdMerge = !existingSchema.path?.("cityId");
  const needsZoneLabelMerge = !existingSchema.path?.("zoneLabel");
  const needsReferralMerge =
    !existingSchema.path?.("merchantType") ||
    !existingSchema.path?.("deliveryType") ||
    !existingSchema.path?.("ownerName") ||
    !existingSchema.path?.("email") ||
    !existingSchema.path?.("area") ||
    !existingSchema.path?.("coverImageUrl") ||
    !existingSchema.path?.("cuisineType") ||
    !existingSchema.path?.("storeCategory") ||
    !existingSchema.path?.("minimumOrderAmount") ||
    !existingSchema.path?.("deliveryRadiusKm") ||
    !existingSchema.path?.("autoAcceptOrders") ||
    !existingSchema.path?.("payout") ||
    !existingSchema.path?.("referralCode") ||
    !existingSchema.path?.("referredByCode") ||
    !existingSchema.path?.("promotionCredits") ||
    !existingSchema.path?.("referralBonusAudit");
  if (
    !existingSchema.__businessSchemaMerged ||
    needsDeliveryPolicyMerge ||
    needsCityIdMerge ||
    needsZoneLabelMerge ||
    needsReferralMerge
  ) {
    const schemaObj = (BusinessSchema as unknown as { obj: Record<string, unknown> }).obj;
    existingSchema.add?.(schemaObj);
    existingSchema.__businessSchemaMerged = true;
  }
}

export const Business = existingBusinessModel || model("Business", BusinessSchema);
