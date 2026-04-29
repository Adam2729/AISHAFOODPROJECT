import { Schema, model, models } from "mongoose";
import { PROMO_CODE_MAX_LEN, PROMO_MAX_FIXED_RDP, PROMO_MAX_PERCENT } from "@/lib/constants";

const CODE_REGEX = /^[A-Z0-9\-_]+$/;

const PromoCodeSchema = new Schema(
  {
    code: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      uppercase: true,
      maxlength: PROMO_CODE_MAX_LEN,
      match: CODE_REGEX,
      index: true,
    },
    cityId: { type: Schema.Types.ObjectId, ref: "City", required: true, index: true },
    discountType: {
      type: String,
      enum: ["percentage", "flat"],
      required: true,
    },
    discountValue: { type: Number, required: true, min: 0.01 },
    maxDiscount: { type: Number, default: null, min: 0 },
    minOrderAmount: { type: Number, default: null, min: 0 },
    usageLimit: { type: Number, default: null, min: 1 },
    usageCount: { type: Number, default: 0, min: 0 },
    isActive: { type: Boolean, default: true, index: true },
    expiresAt: { type: Date, default: null },
  },
  { timestamps: true }
);

PromoCodeSchema.index({ cityId: 1, isActive: 1 });

PromoCodeSchema.pre("validate", function () {
  this.code = String(this.code || "").trim().toUpperCase();

  if (!CODE_REGEX.test(this.code)) {
    const err = new Error("Promo code contains invalid characters.") as Error & {
      status?: number;
      code?: string;
    };
    err.status = 400;
    err.code = "VALIDATION_ERROR";
    throw err;
  }

  if (this.discountType === "percentage") {
    const value = Number(this.discountValue || 0);
    if (value < 1 || value > PROMO_MAX_PERCENT) {
      const err = new Error(
        `Percentage promo value must be between 1 and ${PROMO_MAX_PERCENT}.`
      ) as Error & {
        status?: number;
        code?: string;
      };
      err.status = 400;
      err.code = "VALIDATION_ERROR";
      throw err;
    }
  }

  if (this.discountType === "flat") {
    const value = Number(this.discountValue || 0);
    if (value < 1 || value > PROMO_MAX_FIXED_RDP) {
      const err = new Error(
        `Flat promo value must be between 1 and ${PROMO_MAX_FIXED_RDP}.`
      ) as Error & {
        status?: number;
        code?: string;
      };
      err.status = 400;
      err.code = "VALIDATION_ERROR";
      throw err;
    }
  }
});

export const PromoCode = models.PromoCode || model("PromoCode", PromoCodeSchema);
