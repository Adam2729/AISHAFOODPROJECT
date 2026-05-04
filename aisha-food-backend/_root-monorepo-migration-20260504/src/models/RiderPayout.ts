import { Schema, model, models } from "mongoose";

const RiderPayoutSchema = new Schema(
  {
    cityId: { type: Schema.Types.ObjectId, ref: "City", required: true, index: true },
    orderId: { type: Schema.Types.ObjectId, ref: "Order", required: true, unique: true, index: true },
    driverId: { type: Schema.Types.ObjectId, ref: "Driver", default: null, index: true },
    driverRef: { type: String, default: null, trim: true, maxlength: 80 },
    businessId: { type: Schema.Types.ObjectId, ref: "Business", required: true, index: true },
    weekKey: { type: String, required: true, index: true },
    amount: { type: Number, required: true, min: 0 },
    deliveryFeeCharged: { type: Number, required: true, min: 0 },
    platformMargin: { type: Number, required: true, min: 0 },
    status: { type: String, enum: ["pending", "paid", "void"], default: "pending", index: true },
    paidAt: { type: Date, default: null },
    paidByAdminId: { type: String, default: null, trim: true, maxlength: 80 },
    note: { type: String, default: null, trim: true, maxlength: 280 },
  },
  { timestamps: true, collection: "riderpayouts" }
);

RiderPayoutSchema.index({ orderId: 1 }, { unique: true });
RiderPayoutSchema.index({ status: 1, createdAt: -1 });
RiderPayoutSchema.index({ driverId: 1, status: 1, createdAt: -1 });
RiderPayoutSchema.index({ cityId: 1, weekKey: 1, status: 1 });

export const RiderPayout = models.RiderPayout || model("RiderPayout", RiderPayoutSchema);

