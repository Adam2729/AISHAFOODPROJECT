import { Schema, model, models } from "mongoose";

const PaymentEventSchema = new Schema(
  {
    orderId: { type: Schema.Types.ObjectId, ref: "Order", default: null, index: true },
    cityId: { type: Schema.Types.ObjectId, ref: "City", required: true, index: true },
    method: {
      type: String,
      enum: ["cash", "mobile_money", "wallet", "card"],
      required: true,
    },
    status: {
      type: String,
      enum: ["pending", "authorized", "paid", "failed", "refunded"],
      required: true,
    },
    amount: { type: Number, required: true, min: 0 },
    provider: { type: String, default: null, trim: true, maxlength: 120 },
    reference: { type: String, default: null, trim: true, maxlength: 120 },
    notes: { type: String, default: null, trim: true, maxlength: 280 },
    createdBy: { type: String, default: null, trim: true, maxlength: 60 },
  },
  { timestamps: true }
);

PaymentEventSchema.index({ orderId: 1, createdAt: -1 });
PaymentEventSchema.index({ cityId: 1, method: 1, status: 1, createdAt: -1 });

export const PaymentEvent = models.PaymentEvent || model("PaymentEvent", PaymentEventSchema);
