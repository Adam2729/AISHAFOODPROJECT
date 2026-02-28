import { Schema, model, models } from "mongoose";

const SettlementSchema = new Schema(
  {
    cityId: { type: Schema.Types.ObjectId, ref: "City", default: null, index: true },
    businessId: { type: Schema.Types.ObjectId, ref: "Business", required: true, index: true },
    businessName: { type: String, required: true },
    weekKey: { type: String, required: true, index: true },
    status: { type: String, enum: ["pending", "collected", "locked"], default: "pending", index: true },
    ordersCount: { type: Number, default: 0 },
    grossSubtotal: { type: Number, default: 0 },
    feeTotal: { type: Number, default: 0 },
    integrityHash: { type: String, default: null, index: true },
    integrityHashAlgo: { type: String, enum: ["sha256"], default: "sha256" },
    integrityHashAt: { type: Date, default: null },
    integrityHashVersion: { type: Number, default: 1 },
    receiptRef: { type: String, default: "" },
    collectorName: { type: String, trim: true, maxlength: 60, default: "" },
    collectionMethod: { type: String, enum: ["cash", "transfer", "other"], default: "cash" },
    receiptPhotoUrl: { type: String, trim: true, maxlength: 500, default: "" },
    collectedAt: { type: Date, default: null },
    lockedAt: { type: Date, default: null },
    lockedBy: { type: String, default: null },
    resolutionStatus: {
      type: String,
      enum: ["confirmed_correct", "adjusted", "merchant_disputed", "writeoff"],
      default: null,
    },
    resolutionNote: { type: String, trim: true, maxlength: 500, default: null },
    resolutionAttachmentUrl: { type: String, trim: true, maxlength: 500, default: null },
    resolvedAt: { type: Date, default: null },
    resolvedBy: { type: String, trim: true, maxlength: 60, default: null },
  },
  { timestamps: true }
);

SettlementSchema.index({ businessId: 1, weekKey: 1 }, { unique: true });
SettlementSchema.index({ cityId: 1, weekKey: 1, status: 1 });

function settlementLockedError() {
  const err = new Error("Settlement is locked and cannot be modified.") as Error & {
    status?: number;
    code?: string;
  };
  err.status = 409;
  err.code = "SETTLEMENT_LOCKED";
  return err;
}

async function preventUpdatesToLockedSettlements(context: {
  getQuery: () => unknown;
  model: {
    exists: (query: Record<string, unknown>) => unknown;
  };
}) {
  const query = (context.getQuery() || {}) as Record<string, unknown>;
  const lockedMatch = await Promise.resolve(
    context.model.exists({
      $and: [query, { status: "locked" }],
    })
  );
  if (lockedMatch) {
    throw settlementLockedError();
  }
}

SettlementSchema.pre("findOneAndUpdate", async function () {
  await preventUpdatesToLockedSettlements(this);
});

SettlementSchema.pre("updateOne", async function () {
  await preventUpdatesToLockedSettlements(this);
});

SettlementSchema.pre("updateMany", async function () {
  await preventUpdatesToLockedSettlements(this);
});

export const Settlement = models.Settlement || model("Settlement", SettlementSchema);
