import { Schema, model, models } from "mongoose";

const DriverCashHandoffAuditSchema = new Schema(
  {
    handoffId: { type: Schema.Types.ObjectId, ref: "DriverCashHandoff", required: true, index: true },
    orderId: { type: Schema.Types.ObjectId, ref: "Order", required: true, index: true },
    businessId: { type: Schema.Types.ObjectId, ref: "Business", required: true, index: true },
    driverId: { type: Schema.Types.ObjectId, ref: "Driver", required: true, index: true },
    weekKey: { type: String, required: true, index: true },
    action: {
      type: String,
      enum: ["CREATE", "MARK_HANDED", "DISPUTE_OPEN", "DISPUTE_RESOLVE", "VOID"],
      required: true,
      index: true,
    },
    actor: {
      type: String,
      enum: ["driver", "merchant", "admin"],
      required: true,
      index: true,
    },
    meta: {
      amount: { type: Number, default: null },
      receiptRef: { type: String, trim: true, maxlength: 120, default: null },
      proofUrl: { type: String, trim: true, maxlength: 500, default: null },
      reason: { type: String, trim: true, maxlength: 280, default: null },
      resolution: {
        type: String,
        enum: ["merchant_confirmed", "driver_confirmed", "writeoff", null],
        default: null,
      },
      note: { type: String, trim: true, maxlength: 280, default: null },
    },
  },
  {
    collection: "drivercashhandoffaudits",
    timestamps: { createdAt: true, updatedAt: false },
  }
);

DriverCashHandoffAuditSchema.index({ handoffId: 1, createdAt: -1 });
DriverCashHandoffAuditSchema.index({ orderId: 1, createdAt: -1 });
DriverCashHandoffAuditSchema.index({ businessId: 1, weekKey: 1, createdAt: -1 });
DriverCashHandoffAuditSchema.index({ driverId: 1, weekKey: 1, createdAt: -1 });
DriverCashHandoffAuditSchema.index({ action: 1, createdAt: -1 });

export const DriverCashHandoffAudit =
  models.DriverCashHandoffAudit || model("DriverCashHandoffAudit", DriverCashHandoffAuditSchema);
