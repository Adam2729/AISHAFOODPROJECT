import { Schema, model, models } from "mongoose";

const LoyaltyEventSchema = new Schema(
  {
    cityId: { type: Schema.Types.ObjectId, ref: "City", required: true, index: true },
    phoneHash: { type: String, required: true, trim: true, index: true },
    eventType: {
      type: String,
      enum: ["order_points", "referral_reward", "manual_credit", "redeem"],
      required: true,
      index: true,
    },
    points: { type: Number, default: 0 },
    walletAmount: { type: Number, default: 0 },
    orderId: { type: Schema.Types.ObjectId, ref: "Order", default: null, index: true },
    referralId: { type: Schema.Types.ObjectId, ref: "Referral", default: null, index: true },
    notes: { type: String, default: null, trim: true, maxlength: 280 },
  },
  { timestamps: true }
);

LoyaltyEventSchema.index({ phoneHash: 1, createdAt: -1 });
LoyaltyEventSchema.index({ cityId: 1, eventType: 1 });

export const LoyaltyEvent =
  models.LoyaltyEvent || model("LoyaltyEvent", LoyaltyEventSchema);
