import { Schema, model, models } from "mongoose";
import { COMMISSION_RATE_DEFAULT, GRACE_DAYS, TRIAL_DAYS } from "@/lib/constants";
import { addDays } from "@/lib/subscription";

const BusinessSchema = new Schema(
  {
    cityId: { type: Schema.Types.ObjectId, ref: "City", default: null, index: true },
    type: { type: String, enum: ["restaurant", "colmado"], required: true, index: true },
    name: { type: String, required: true, trim: true, index: true },
    phone: { type: String, required: true, trim: true },
    whatsapp: { type: String, default: "", trim: true },
    address: { type: String, required: true, trim: true },
    logoUrl: { type: String, default: "" },
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
    deliveryPolicy: {
      mode: { type: String, enum: ["self_delivery"], default: "self_delivery" },
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
      timezone: { type: String, default: "America/Santo_Domingo" },
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

const existingBusinessModel = models.Business;
if (existingBusinessModel) {
  const existingSchema = existingBusinessModel.schema as Schema & {
    __businessSchemaMerged?: boolean;
    add?: (obj: Record<string, unknown>) => unknown;
    path?: (name: string) => unknown;
  };
  const needsDeliveryPolicyMerge = !existingSchema.path?.("deliveryPolicy");
  const needsCityIdMerge = !existingSchema.path?.("cityId");
  if (!existingSchema.__businessSchemaMerged || needsDeliveryPolicyMerge || needsCityIdMerge) {
    const schemaObj = (BusinessSchema as unknown as { obj: Record<string, unknown> }).obj;
    existingSchema.add?.(schemaObj);
    existingSchema.__businessSchemaMerged = true;
  }
}

export const Business = existingBusinessModel || model("Business", BusinessSchema);
