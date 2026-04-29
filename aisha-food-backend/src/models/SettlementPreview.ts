import { Schema, model, models } from "mongoose";

const SettlementPreviewSchema = new Schema(
  {
    businessId: { type: Schema.Types.ObjectId, ref: "Business", required: true, index: true },
    businessName: { type: String, required: true, trim: true },
    weekKey: { type: String, required: true, index: true },
    expectedOrdersCount: { type: Number, default: 0 },
    expectedGrossSubtotal: { type: Number, default: 0 },
    expectedFeeTotal: { type: Number, default: 0 },
    storedExists: { type: Boolean, default: false },
    storedOrdersCount: { type: Number, default: null },
    storedGrossSubtotal: { type: Number, default: null },
    storedFeeTotal: { type: Number, default: null },
    integrityHasHash: { type: Boolean, default: false },
    integrityHashMatches: { type: Boolean, default: null, index: true },
    diffOrdersCount: { type: Number, default: null },
    diffGrossSubtotal: { type: Number, default: null },
    diffFeeTotal: { type: Number, default: null },
    mismatch: { type: Boolean, default: false, index: true },
    generatedAt: { type: Date, required: true },
  },
  {
    timestamps: true,
    collection: "settlementpreviews",
  }
);

SettlementPreviewSchema.index({ businessId: 1, weekKey: 1 }, { unique: true });
SettlementPreviewSchema.index({ mismatch: 1, generatedAt: -1 });
SettlementPreviewSchema.index({ weekKey: 1, mismatch: 1 });

export const SettlementPreview =
  models.SettlementPreview || model("SettlementPreview", SettlementPreviewSchema);
