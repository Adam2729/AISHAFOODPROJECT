import { Schema, model, models } from "mongoose";

const RiderPayoutBatchSchema = new Schema(
  {
    cityId: { type: Schema.Types.ObjectId, ref: "City", required: true, index: true },
    weekKey: { type: String, required: true, trim: true, index: true },
    status: {
      type: String,
      enum: ["open", "paid", "void"],
      default: "open",
      index: true,
    },
    payoutIds: [{ type: Schema.Types.ObjectId, ref: "RiderPayout", default: [] }],
    payoutsCount: { type: Number, default: 0, min: 0 },
    totalAmount: { type: Number, default: 0, min: 0 },
    totalDeliveryFeeCharged: { type: Number, default: 0, min: 0 },
    totalPlatformMargin: { type: Number, default: 0, min: 0 },
    createdByAdminId: { type: String, default: null, trim: true, maxlength: 80 },
    paidAt: { type: Date, default: null },
    paidByAdminId: { type: String, default: null, trim: true, maxlength: 80 },
    note: { type: String, default: null, trim: true, maxlength: 280 },
  },
  { timestamps: true, collection: "riderpayoutbatches" }
);

RiderPayoutBatchSchema.index({ cityId: 1, weekKey: 1, status: 1 }, { unique: true });
RiderPayoutBatchSchema.index({ cityId: 1, weekKey: 1, status: 1, createdAt: -1 });
RiderPayoutBatchSchema.index({ status: 1, updatedAt: -1 });

export const RiderPayoutBatch =
  models.RiderPayoutBatch || model("RiderPayoutBatch", RiderPayoutBatchSchema);
