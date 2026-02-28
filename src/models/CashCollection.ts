import { Schema, model, models } from "mongoose";

const CashCollectionSchema = new Schema(
  {
    businessId: { type: Schema.Types.ObjectId, ref: "Business", required: true, index: true },
    businessName: { type: String, required: true, trim: true },
    weekKey: { type: String, required: true, index: true },
    status: {
      type: String,
      enum: ["open", "submitted", "verified", "disputed", "closed"],
      default: "open",
      index: true,
    },
    expected: {
      ordersCount: { type: Number, default: 0 },
      grossSubtotal: { type: Number, default: 0 },
      promoDiscountTotal: { type: Number, default: 0 },
      netSubtotal: { type: Number, default: 0 },
      commissionTotal: { type: Number, default: 0 },
    },
    reported: {
      cashCollected: { type: Number, default: null },
      grossSubtotal: { type: Number, default: null },
      netSubtotal: { type: Number, default: null },
      commissionTotal: { type: Number, default: null },
      ordersCount: { type: Number, default: null },
      collectorName: { type: String, trim: true, maxlength: 60, default: null },
      collectionMethod: {
        type: String,
        enum: ["in_person", "bank_deposit", "bank_transfer", "transfer", "pickup", "other", null],
        default: null,
      },
      receiptPhotoUrl: { type: String, trim: true, maxlength: 500, default: null },
      receiptRef: { type: String, trim: true, maxlength: 80, default: null },
      reportedAt: { type: Date, default: null },
    },
    discrepancy: {
      cashDiff: { type: Number, default: 0 },
      ordersDiff: { type: Number, default: 0 },
    },
    integrity: {
      expectedHash: { type: String, required: true, default: "" },
      computedAt: { type: Date, default: null },
      status: { type: String, enum: ["ok", "mismatch"], default: "ok" },
    },
    driverCash: {
      driverCollectedTotalRdp: { type: Number, default: 0 },
      driverHandedTotalRdp: { type: Number, default: 0 },
      driverDisputedTotalRdp: { type: Number, default: 0 },
      merchantCashReceivedTotalRdp: { type: Number, default: 0 },
      mismatchSignal: { type: Boolean, default: false },
    },
    notes: { type: String, trim: true, maxlength: 500, default: null },
    submittedByMerchantId: { type: Schema.Types.ObjectId, default: null },
    submittedAt: { type: Date, default: null, index: true },
    verifiedAt: { type: Date, default: null, index: true },
  },
  {
    collection: "cashcollections",
    timestamps: true,
  }
);

CashCollectionSchema.index({ businessId: 1, weekKey: 1 }, { unique: true });
CashCollectionSchema.index({ status: 1, updatedAt: -1 });
CashCollectionSchema.index({ weekKey: 1, status: 1 });
CashCollectionSchema.index({ businessId: 1, weekKey: 1, status: 1 });

const existingCashCollectionModel = models.CashCollection;
if (existingCashCollectionModel) {
  const existingSchema = existingCashCollectionModel.schema as Schema & {
    __cashCollectionSchemaMerged?: boolean;
    add?: (obj: Record<string, unknown>) => unknown;
    path?: (name: string) => unknown;
  };
  const needsMerge = !existingSchema.path?.("driverCash.driverCollectedTotalRdp");
  if (!existingSchema.__cashCollectionSchemaMerged || needsMerge) {
    const schemaObj = (CashCollectionSchema as unknown as { obj: Record<string, unknown> }).obj;
    existingSchema.add?.(schemaObj);
    existingSchema.__cashCollectionSchemaMerged = true;
  }
}

export const CashCollection = existingCashCollectionModel || model("CashCollection", CashCollectionSchema);
