import { Schema, model, models } from "mongoose";

const IncentiveRuleSchema = new Schema(
  {
    cityId: { type: Schema.Types.ObjectId, ref: "City", required: true, index: true },
    name: { type: String, required: true, trim: true, maxlength: 120 },
    type: {
      type: String,
      enum: ["deliveries_count", "revenue_amount", "peak_hours"],
      required: true,
      index: true,
    },
    threshold: { type: Number, required: true, min: 0 },
    rewardAmount: { type: Number, required: true, min: 0 },
    period: {
      type: String,
      enum: ["daily", "weekly"],
      required: true,
      index: true,
    },
    isActive: { type: Boolean, default: true, index: true },
    startsAt: { type: Date, default: null },
    endsAt: { type: Date, default: null },
    notes: { type: String, default: null, trim: true, maxlength: 280 },
  },
  { timestamps: true }
);

IncentiveRuleSchema.index({ cityId: 1, isActive: 1 });
IncentiveRuleSchema.index({ cityId: 1, type: 1, period: 1 });

export const IncentiveRule =
  models.IncentiveRule || model("IncentiveRule", IncentiveRuleSchema);
