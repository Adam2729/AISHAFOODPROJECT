import { Schema, model, models } from "mongoose";

const PromoRedemptionSchema = new Schema(
  {
    promoId: { type: Schema.Types.ObjectId, ref: "Promo", required: true, index: true },
    code: { type: String, required: true, trim: true, uppercase: true, index: true },
    businessId: { type: Schema.Types.ObjectId, ref: "Business", required: true, index: true },
    weekKey: { type: String, required: true, index: true },
    phoneHash: { type: String, required: true, index: true },
    orderId: { type: Schema.Types.ObjectId, ref: "Order", required: true, unique: true, index: true },
    subtotalBefore: { type: Number, required: true, min: 0 },
    discountAmount: { type: Number, required: true, min: 0 },
    subtotalAfter: { type: Number, required: true, min: 0 },
  },
  { timestamps: true }
);

PromoRedemptionSchema.index({ promoId: 1, phoneHash: 1 });
PromoRedemptionSchema.index({ code: 1, createdAt: -1 });
PromoRedemptionSchema.index({ businessId: 1, weekKey: 1 });
PromoRedemptionSchema.index({ orderId: 1 }, { unique: true });

export const PromoRedemption = models.PromoRedemption || model("PromoRedemption", PromoRedemptionSchema);
