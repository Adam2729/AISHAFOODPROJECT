import { Schema, model, models } from "mongoose";
import { PROMO_CODE_MAX_LEN, PROMO_MAX_FIXED_RDP, PROMO_MAX_PERCENT } from "@/lib/constants";

const CODE_REGEX = /^[A-Z0-9\-_]+$/;

const PromoSchema = new Schema(
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
    type: { type: String, enum: ["percentage", "fixed"], required: true },
    value: { type: Number, required: true, min: 1 },
    minSubtotal: { type: Number, default: 0, min: 0 },
    expiresAt: { type: Date, default: null },
    maxRedemptions: { type: Number, default: null, min: 1 },
    perPhoneLimit: { type: Number, default: 1, min: 1 },
    businessAllowlist: [{ type: Schema.Types.ObjectId, ref: "Business" }],
    fundedBy: { type: String, enum: ["platform"], default: "platform", required: true },
    isActive: { type: Boolean, default: true, index: true },
  },
  { timestamps: true }
);

PromoSchema.index({ code: 1 }, { unique: true });
PromoSchema.index({ isActive: 1, expiresAt: 1 });

PromoSchema.pre("validate", function () {
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

  if (this.type === "percentage") {
    if (Number(this.value) < 1 || Number(this.value) > PROMO_MAX_PERCENT) {
      const err = new Error(`Percentage promo value must be between 1 and ${PROMO_MAX_PERCENT}.`) as Error & {
        status?: number;
        code?: string;
      };
      err.status = 400;
      err.code = "VALIDATION_ERROR";
      throw err;
    }
  }

  if (this.type === "fixed") {
    if (Number(this.value) < 1 || Number(this.value) > PROMO_MAX_FIXED_RDP) {
      const err = new Error(`Fixed promo value must be between 1 and ${PROMO_MAX_FIXED_RDP}.`) as Error & {
        status?: number;
        code?: string;
      };
      err.status = 400;
      err.code = "VALIDATION_ERROR";
      throw err;
    }
  }
});

export const Promo = models.Promo || model("Promo", PromoSchema);
