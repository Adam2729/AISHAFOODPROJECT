import { Schema, model, models } from "mongoose";

const DispatchAuditSchema = new Schema(
  {
    orderId: { type: Schema.Types.ObjectId, ref: "Order", required: true, index: true },
    businessId: { type: Schema.Types.ObjectId, ref: "Business", required: true, index: true },
    action: {
      type: String,
      enum: [
        "ASSIGN_DRIVER",
        "UNASSIGN_DRIVER",
        "PICKUP_CONFIRMED",
        "DELIVERED_CONFIRMED",
        "CASH_HANDOFF_NOTE",
      ],
      required: true,
      index: true,
    },
    actor: {
      type: String,
      enum: ["admin", "merchant", "driver"],
      required: true,
      index: true,
    },
    meta: {
      driverId: { type: Schema.Types.ObjectId, ref: "Driver", default: null },
      driverName: { type: String, default: null, trim: true },
      note: { type: String, default: null, trim: true, maxlength: 200 },
    },
  },
  {
    collection: "dispatchaudits",
    timestamps: { createdAt: true, updatedAt: false },
  }
);

DispatchAuditSchema.index({ orderId: 1, createdAt: -1 });
DispatchAuditSchema.index({ businessId: 1, createdAt: -1 });
DispatchAuditSchema.index({ action: 1, createdAt: -1 });

export const DispatchAudit =
  models.DispatchAudit || model("DispatchAudit", DispatchAuditSchema);
