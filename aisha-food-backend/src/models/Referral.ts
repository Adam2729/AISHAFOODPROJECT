import { Schema, model, models } from "mongoose";

const ReferralSchema = new Schema(
  {
    referrerPhoneHash: { type: String, required: true, trim: true, index: true },
    referredPhoneHash: { type: String, required: true, trim: true, index: true },
    cityId: { type: Schema.Types.ObjectId, ref: "City", required: true, index: true },
    rewardAmount: { type: Number, required: true, min: 0 },
    status: {
      type: String,
      enum: ["pending", "earned", "paid"],
      default: "pending",
      index: true,
    },
    orderId: { type: Schema.Types.ObjectId, ref: "Order", default: null, index: true },
  },
  { timestamps: true }
);

export const Referral = models.Referral || model("Referral", ReferralSchema);
