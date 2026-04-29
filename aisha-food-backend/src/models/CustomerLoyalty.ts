import { Schema, model, models } from "mongoose";

const CustomerLoyaltySchema = new Schema(
  {
    phoneHash: { type: String, required: true, trim: true, index: true },
    cityId: { type: Schema.Types.ObjectId, ref: "City", required: true, index: true },
    points: { type: Number, default: 0, min: 0 },
    lifetimeOrders: { type: Number, default: 0, min: 0 },
    lifetimeSpend: { type: Number, default: 0, min: 0 },
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
    isActive: { type: Boolean, default: true, index: true },
  },
  { timestamps: true }
);

CustomerLoyaltySchema.index({ phoneHash: 1, cityId: 1 }, { unique: true });
CustomerLoyaltySchema.index({ referralCode: 1 }, { unique: true, sparse: true });

export const CustomerLoyalty =
  models.CustomerLoyalty || model("CustomerLoyalty", CustomerLoyaltySchema);
