import { Schema, model, models } from "mongoose";

const CustomerSchema = new Schema(
  {
    cityId: { type: Schema.Types.ObjectId, ref: "City", default: null, index: true },
    phoneHash: { type: String, required: true, unique: true, index: true },
    referralCode: { type: String, unique: true, sparse: true, index: true, trim: true, uppercase: true },
    walletCreditRdp: { type: Number, default: 0, min: 0 },
    firstOrderAt: { type: Date, default: null },
    firstDeliveredAt: { type: Date, default: null },
    ordersCount: { type: Number, default: 0, min: 0 },
    deliveredCount: { type: Number, default: 0, min: 0 },
  },
  { timestamps: true }
);

CustomerSchema.index({ phoneHash: 1 }, { unique: true });
CustomerSchema.index({ cityId: 1, updatedAt: -1 });
CustomerSchema.index({ referralCode: 1 }, { unique: true, sparse: true });

export const Customer = models.Customer || model("Customer", CustomerSchema);
