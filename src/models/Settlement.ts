import { Schema, model, models } from "mongoose";

const SettlementSchema = new Schema(
  {
    businessId: { type: Schema.Types.ObjectId, ref: "Business", required: true, index: true },
    businessName: { type: String, required: true },
    weekKey: { type: String, required: true, index: true },
    status: { type: String, enum: ["pending", "collected", "locked"], default: "pending", index: true },
    ordersCount: { type: Number, default: 0 },
    grossSubtotal: { type: Number, default: 0 },
    feeTotal: { type: Number, default: 0 },
    receiptRef: { type: String, default: "" },
    collectorName: { type: String, trim: true, maxlength: 60, default: "" },
    collectionMethod: { type: String, enum: ["cash", "transfer", "other"], default: "cash" },
    receiptPhotoUrl: { type: String, trim: true, maxlength: 500, default: "" },
    collectedAt: { type: Date, default: null },
    lockedAt: { type: Date, default: null },
    lockedBy: { type: String, default: null },
  },
  { timestamps: true }
);

SettlementSchema.index({ businessId: 1, weekKey: 1 }, { unique: true });

export const Settlement = models.Settlement || model("Settlement", SettlementSchema);
