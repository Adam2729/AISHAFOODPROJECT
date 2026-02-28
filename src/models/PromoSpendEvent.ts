import { Schema, model, models } from "mongoose";

const PromoSpendEventSchema = new Schema(
  {
    weekKey: { type: String, required: true, index: true },
    orderId: { type: Schema.Types.ObjectId, ref: "Order", required: true, unique: true, index: true },
    promoId: { type: Schema.Types.ObjectId, ref: "Promo", required: true, index: true },
    code: { type: String, required: true, trim: true, uppercase: true, index: true },
    businessId: { type: Schema.Types.ObjectId, ref: "Business", required: true, index: true },
    amount: { type: Number, required: true, min: 0 },
  },
  { timestamps: true }
);

PromoSpendEventSchema.index({ weekKey: 1, createdAt: -1 });
PromoSpendEventSchema.index({ weekKey: 1, code: 1, createdAt: -1 });
PromoSpendEventSchema.index({ weekKey: 1, businessId: 1, createdAt: -1 });
PromoSpendEventSchema.index({ orderId: 1 }, { unique: true });

export const PromoSpendEvent =
  models.PromoSpendEvent || model("PromoSpendEvent", PromoSpendEventSchema);

