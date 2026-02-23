import { Schema, model, models } from "mongoose";

const SettlementAuditSchema = new Schema(
  {
    businessId: { type: Schema.Types.ObjectId, ref: "Business", required: true, index: true },
    weekKey: { type: String, required: true, index: true },
    action: {
      type: String,
      enum: ["ORDER_COUNTED", "SETTLEMENT_COLLECTED", "SETTLEMENT_LOCKED", "SETTLEMENT_RECOMPUTE"],
      required: true,
      index: true,
    },
    orderId: { type: Schema.Types.ObjectId, ref: "Order", default: null, index: true },
    amount: { type: Number, default: null },
    meta: { type: Object, default: {} },
  },
  { timestamps: true }
);

SettlementAuditSchema.index({ businessId: 1, weekKey: 1, createdAt: -1 });
SettlementAuditSchema.index({ action: 1, createdAt: -1 });

export const SettlementAudit = models.SettlementAudit || model("SettlementAudit", SettlementAuditSchema);
