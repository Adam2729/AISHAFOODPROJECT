import { Schema, model, models } from "mongoose";

const BUSINESS_AUDIT_ACTIONS = [
  "PAUSED",
  "UNPAUSED",
  "HEALTH_RESET",
  "COMPLAINTS_SET",
  "AUTO_PAUSE_MENU_QUALITY",
  "DELIVERY_POLICY_UPDATED",
  "RIDER_ASSIGNED",
  "DELIVERY_OVERRIDE",
] as const;

const BusinessAuditSchema = new Schema(
  {
    businessId: { type: Schema.Types.ObjectId, ref: "Business", required: true, index: true },
    action: {
      type: String,
      enum: BUSINESS_AUDIT_ACTIONS,
      required: true,
      index: true,
    },
    meta: { type: Object, default: {} },
  },
  {
    timestamps: true,
    collection: "businessaudits",
  }
);

BusinessAuditSchema.index({ businessId: 1, createdAt: -1 });
BusinessAuditSchema.index({ action: 1, createdAt: -1 });

export const BusinessAudit = models.BusinessAudit || model("BusinessAudit", BusinessAuditSchema);
