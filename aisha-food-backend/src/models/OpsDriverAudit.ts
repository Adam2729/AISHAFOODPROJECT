import mongoose, { Schema, model, models } from "mongoose";

const OpsDriverAuditSchema = new Schema(
  {
    cityId: { type: Schema.Types.ObjectId, ref: "City", required: true, index: true },
    driverId: { type: Schema.Types.ObjectId, ref: "Driver", required: true, index: true },
    action: {
      type: String,
      enum: [
        "DRIVER_BANNED",
        "DRIVER_UNBANNED",
        "DRIVER_PAUSED",
        "DRIVER_UNPAUSED",
        "DRIVER_ACTIVATED",
        "DRIVER_DEACTIVATED",
      ],
      required: true,
    },
    actorAdminId: { type: Schema.Types.ObjectId, ref: "User", default: null },
    meta: {
      reason: { type: String, default: null },
      before: { type: Schema.Types.Mixed, default: null },
      after: { type: Schema.Types.Mixed, default: null },
    },
  },
  { timestamps: true, collection: "opsdriveraudits" }
);

OpsDriverAuditSchema.index({ cityId: 1, driverId: 1, createdAt: -1 });

export const OpsDriverAudit =
  models.OpsDriverAudit || model("OpsDriverAudit", OpsDriverAuditSchema);
