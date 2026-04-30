import { Schema, model, models } from "mongoose";
import {
  ACTIVE_MERCHANT_TYPES,
  DELIVERY_TYPES,
  PAYOUT_METHODS,
} from "@/lib/merchantOnboarding";

const MerchantApplicationSchema = new Schema(
  {
    cityId: { type: Schema.Types.ObjectId, ref: "City", required: true, index: true },
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
    },
    deliveryModePreference: {
      type: String,
      enum: ["self_delivery", "platform_driver", "both", ""],
      default: "",
    },
    acceptsPayTech: { type: Boolean, default: false },
    businessName: { type: String, required: true, trim: true, maxlength: 120 },
    ownerName: { type: String, required: true, trim: true, maxlength: 120 },
    phone: { type: String, required: true, trim: true, maxlength: 40 },
    email: { type: String, trim: true, lowercase: true, maxlength: 160, default: "" },
    passwordHash: { type: String, trim: true, maxlength: 280, default: "" },
    whatsapp: { type: String, trim: true, maxlength: 40, default: "" },
    country: { type: String, trim: true, maxlength: 80, default: "" },
    cityName: { type: String, trim: true, maxlength: 80, default: "" },
    area: { type: String, trim: true, maxlength: 120, default: "" },
    address: { type: String, trim: true, maxlength: 200, default: "" },
    cuisineType: { type: String, trim: true, maxlength: 80, default: "" },
    storeCategory: { type: String, trim: true, maxlength: 80, default: "" },
    openingHoursText: { type: String, trim: true, maxlength: 500, default: "" },
    averagePrepMinutes: { type: Number, default: 15, min: 0, max: 240 },
    minimumOrderAmount: { type: Number, default: 0, min: 0 },
    deliveryRadiusKm: { type: Number, default: 8, min: 0, max: 200 },
    logoUrl: { type: String, trim: true, maxlength: 500, default: "" },
    coverImageUrl: { type: String, trim: true, maxlength: 500, default: "" },
    legalIdNumber: { type: String, trim: true, maxlength: 80, default: "" },
    businessRegistrationNumber: { type: String, trim: true, maxlength: 120, default: "" },
    payoutMethod: {
      type: String,
      enum: PAYOUT_METHODS,
      default: "cash_collection",
    },
    payoutDetails: { type: String, trim: true, maxlength: 400, default: "" },
    referredByCode: { type: String, trim: true, maxlength: 24, uppercase: true, default: "" },
    notes: { type: String, trim: true, maxlength: 400, default: "" },
    confirmationEmailStatus: {
      type: String,
      enum: ["pending", "logged", "sent", "failed", "skipped"],
      default: "pending",
    },
    confirmationEmailProvider: { type: String, trim: true, maxlength: 40, default: "" },
    confirmationEmailSentAt: { type: Date, default: null },
    confirmationEmailError: { type: String, trim: true, maxlength: 280, default: "" },
    status: {
      type: String,
      enum: ["pending", "needs_info", "approved", "rejected"],
      default: "pending",
      index: true,
    },
    approvedAt: { type: Date, default: null },
    approvedByAdminId: { type: String, trim: true, maxlength: 80, default: "" },
    rejectedAt: { type: Date, default: null },
    rejectedByAdminId: { type: String, trim: true, maxlength: 80, default: "" },
    createdBusinessId: { type: Schema.Types.ObjectId, ref: "Business", default: null },
    referrerBusinessId: { type: Schema.Types.ObjectId, ref: "Business", default: null },
    referralRewardAmount: { type: Number, default: 0, min: 0 },
    referralBonusAppliedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

MerchantApplicationSchema.index({ cityId: 1, status: 1, createdAt: -1 });
MerchantApplicationSchema.index({ cityId: 1, phone: 1, businessName: 1 });
MerchantApplicationSchema.index({ cityId: 1, email: 1 });
MerchantApplicationSchema.index({ merchantType: 1, cityId: 1, createdAt: -1 });

const existingMerchantApplicationModel = models.MerchantApplication;
if (existingMerchantApplicationModel) {
  const existingSchema = existingMerchantApplicationModel.schema as Schema & {
    __merchantApplicationSchemaMerged?: boolean;
    add?: (obj: Record<string, unknown>) => unknown;
    path?: (name: string) => unknown;
  };
  const needsReferralMerge =
    !existingSchema.path?.("merchantType") ||
    !existingSchema.path?.("deliveryType") ||
    !existingSchema.path?.("deliveryModePreference") ||
    !existingSchema.path?.("acceptsPayTech") ||
    !existingSchema.path?.("email") ||
    !existingSchema.path?.("passwordHash") ||
    !existingSchema.path?.("country") ||
    !existingSchema.path?.("cityName") ||
    !existingSchema.path?.("area") ||
    !existingSchema.path?.("storeCategory") ||
    !existingSchema.path?.("openingHoursText") ||
    !existingSchema.path?.("averagePrepMinutes") ||
    !existingSchema.path?.("minimumOrderAmount") ||
    !existingSchema.path?.("deliveryRadiusKm") ||
    !existingSchema.path?.("logoUrl") ||
    !existingSchema.path?.("coverImageUrl") ||
    !existingSchema.path?.("legalIdNumber") ||
    !existingSchema.path?.("businessRegistrationNumber") ||
    !existingSchema.path?.("payoutMethod") ||
    !existingSchema.path?.("payoutDetails") ||
    !existingSchema.path?.("referredByCode") ||
    !existingSchema.path?.("confirmationEmailStatus") ||
    !existingSchema.path?.("confirmationEmailProvider") ||
    !existingSchema.path?.("confirmationEmailSentAt") ||
    !existingSchema.path?.("confirmationEmailError") ||
    !existingSchema.path?.("referrerBusinessId") ||
    !existingSchema.path?.("referralRewardAmount") ||
    !existingSchema.path?.("referralBonusAppliedAt");
  if (!existingSchema.__merchantApplicationSchemaMerged || needsReferralMerge) {
    const schemaObj = (MerchantApplicationSchema as unknown as { obj: Record<string, unknown> }).obj;
    existingSchema.add?.(schemaObj);
    existingSchema.__merchantApplicationSchemaMerged = true;
  }
}

export const MerchantApplication =
  existingMerchantApplicationModel ||
  model("MerchantApplication", MerchantApplicationSchema, "merchantapplications");
