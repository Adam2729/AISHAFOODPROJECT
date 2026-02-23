import { Schema, model, models } from "mongoose";
import { COMMISSION_RATE_DEFAULT, GRACE_DAYS, TRIAL_DAYS } from "@/lib/constants";
import { addDays } from "@/lib/subscription";

const BusinessSchema = new Schema(
  {
    type: { type: String, enum: ["restaurant", "colmado"], required: true, index: true },
    name: { type: String, required: true, trim: true, index: true },
    phone: { type: String, required: true, trim: true },
    whatsapp: { type: String, default: "", trim: true },
    address: { type: String, required: true, trim: true },
    logoUrl: { type: String, default: "" },
    location: {
      type: {
        type: String,
        enum: ["Point"],
        default: "Point",
      },
      coordinates: {
        type: [Number], // [lng, lat]
        required: true,
      },
    },
    isActive: { type: Boolean, default: true, index: true },
    isDemo: { type: Boolean, default: false, index: true },
    paused: { type: Boolean, default: false, index: true },
    pausedReason: { type: String, default: "", trim: true, maxlength: 140 },
    pausedAt: { type: Date, default: null },
    commissionRate: { type: Number, default: COMMISSION_RATE_DEFAULT },
    health: {
      complaintsCount: { type: Number, default: 0 },
      cancelsCount30d: { type: Number, default: 0 },
      slowAcceptCount30d: { type: Number, default: 0 },
      lastHealthUpdateAt: { type: Date, default: null },
      lastHealthResetAt: { type: Date, default: null },
    },
    auth: {
      pinHash: { type: String, required: true },
      mustChange: { type: Boolean, default: false },
    },
    subscription: {
      status: { type: String, enum: ["trial", "active", "past_due", "suspended"], default: "trial" },
      trialDays: { type: Number, default: TRIAL_DAYS },
      graceDays: { type: Number, default: GRACE_DAYS },
      trialStartedAt: { type: Date, default: Date.now },
      trialEndsAt: { type: Date, default: () => addDays(new Date(), TRIAL_DAYS) },
      lastPaidAt: { type: Date, default: null },
      paidUntilAt: { type: Date, default: null },
    },
  },
  { timestamps: true }
);

BusinessSchema.index({ location: "2dsphere" });

export const Business = models.Business || model("Business", BusinessSchema);
