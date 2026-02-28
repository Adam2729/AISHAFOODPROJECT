import { Schema, model, models } from "mongoose";

const FINANCE_ALERT_TYPES = [
  "FIN_MISSING_SETTLEMENT",
  "FIN_MISSING_CASH",
  "FIN_HASH_MISMATCH",
  "FIN_DIFF_OVER_THRESHOLD",
  "FIN_STALE_SUBMISSION",
] as const;

const FinanceAlertSchema = new Schema(
  {
    weekKey: { type: String, required: true, index: true },
    dayKey: { type: String, required: true, index: true },
    businessId: { type: Schema.Types.ObjectId, ref: "Business", required: true, index: true },
    businessName: { type: String, required: true, trim: true },
    type: { type: String, enum: FINANCE_ALERT_TYPES, required: true, index: true },
    severity: { type: String, enum: ["high", "medium", "low"], required: true, index: true },
    status: {
      type: String,
      enum: ["open", "acknowledged", "resolved"],
      default: "open",
      index: true,
    },
    meta: { type: Object, default: null },
    firstSeenAt: { type: Date, default: null },
    lastSeenAt: { type: Date, default: null },
    ack: {
      by: { type: String, trim: true, maxlength: 60, default: null },
      at: { type: Date, default: null },
      note: { type: String, trim: true, maxlength: 280, default: null },
    },
    resolved: {
      by: { type: String, trim: true, maxlength: 60, default: null },
      at: { type: Date, default: null },
      note: { type: String, trim: true, maxlength: 280, default: null },
    },
  },
  { timestamps: true, collection: "financealerts" }
);

FinanceAlertSchema.index({ businessId: 1, weekKey: 1, type: 1, dayKey: 1 }, { unique: true });
FinanceAlertSchema.index({ status: 1, severity: 1, lastSeenAt: -1 });
FinanceAlertSchema.index({ weekKey: 1, status: 1, severity: 1 });

export const FinanceAlert = models.FinanceAlert || model("FinanceAlert", FinanceAlertSchema);
