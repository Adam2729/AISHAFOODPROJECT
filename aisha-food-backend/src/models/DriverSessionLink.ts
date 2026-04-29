import { Schema, model, models } from "mongoose";

const DriverSessionLinkSchema = new Schema(
  {
    cityId: { type: Schema.Types.ObjectId, ref: "City", required: true, index: true },
    driverId: { type: Schema.Types.ObjectId, ref: "Driver", required: true, index: true },
    tokenHash: { type: String, required: true, unique: true, index: true },
    expiresAt: { type: Date, required: true },
    usedAt: { type: Date, default: null },
    createdByAdminId: { type: String, default: null, trim: true, maxlength: 80 },
  },
  { timestamps: true, collection: "driversessionlinks" }
);

DriverSessionLinkSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
DriverSessionLinkSchema.index({ cityId: 1, driverId: 1, createdAt: -1 });

export const DriverSessionLink =
  models.DriverSessionLink || model("DriverSessionLink", DriverSessionLinkSchema);
