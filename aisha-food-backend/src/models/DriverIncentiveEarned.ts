import { Schema, model, models } from "mongoose";

const DriverIncentiveEarnedSchema = new Schema(
  {
    cityId: { type: Schema.Types.ObjectId, ref: "City", required: true, index: true },
    driverId: { type: Schema.Types.ObjectId, ref: "Driver", required: true, index: true },
    ruleId: { type: Schema.Types.ObjectId, ref: "IncentiveRule", required: true, index: true },
    periodKey: { type: String, required: true, trim: true, maxlength: 24 },
    rewardAmount: { type: Number, required: true, min: 0 },
    status: {
      type: String,
      enum: ["earned", "paid"],
      default: "earned",
      index: true,
    },
    meta: { type: Schema.Types.Mixed, default: null },
  },
  { timestamps: true }
);

DriverIncentiveEarnedSchema.index(
  { driverId: 1, ruleId: 1, periodKey: 1 },
  { unique: true }
);
DriverIncentiveEarnedSchema.index({ cityId: 1, driverId: 1, status: 1 });

export const DriverIncentiveEarned =
  models.DriverIncentiveEarned ||
  model("DriverIncentiveEarned", DriverIncentiveEarnedSchema);
