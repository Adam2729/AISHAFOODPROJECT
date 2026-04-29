import { Schema, model, models } from "mongoose";

const WalletSchema = new Schema(
  {
    phoneHash: { type: String, required: true, trim: true, index: true },
    cityId: { type: Schema.Types.ObjectId, ref: "City", required: true, index: true },
    balance: { type: Number, default: 0, min: 0 },
    currency: { type: String, required: true, trim: true, maxlength: 12 },
    isActive: { type: Boolean, default: true, index: true },
  },
  { timestamps: true }
);

WalletSchema.index({ phoneHash: 1, cityId: 1 }, { unique: true });

export const Wallet = models.Wallet || model("Wallet", WalletSchema);
