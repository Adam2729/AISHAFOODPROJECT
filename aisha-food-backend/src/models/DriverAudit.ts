import { Schema, model, models } from "mongoose";

const DriverAuditSchema = new Schema(
  {
    cityId: { type: Schema.Types.ObjectId, ref: "City", required: true, index: true },
    driverId: { type: Schema.Types.ObjectId, ref: "Driver", required: true, index: true },
    orderId: { type: Schema.Types.ObjectId, ref: "Order", default: null, index: true },
    action: { type: String, required: true, trim: true, maxlength: 64, index: true },
    meta: { type: Object, default: {} },
  },
  { timestamps: true, collection: "driveraudits" }
);

DriverAuditSchema.index({ cityId: 1, driverId: 1, createdAt: -1 });
DriverAuditSchema.index({ orderId: 1, createdAt: -1 });
DriverAuditSchema.index({ action: 1, createdAt: -1 });

export const DriverAudit = models.DriverAudit || model("DriverAudit", DriverAuditSchema);
