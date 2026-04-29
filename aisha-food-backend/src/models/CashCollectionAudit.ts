import { Schema, model, models } from "mongoose";

const CashCollectionAuditSchema = new Schema(
  {
    businessId: { type: Schema.Types.ObjectId, ref: "Business", required: true, index: true },
    businessName: { type: String, required: true, trim: true },
    weekKey: { type: String, required: true, index: true },
    cashCollectionId: { type: Schema.Types.ObjectId, ref: "CashCollection", required: true, index: true },
    actor: {
      type: {
        type: String,
        enum: ["admin", "merchant", "system"],
        required: true,
      },
      id: { type: String, default: null },
      label: { type: String, default: null },
    },
    action: {
      type: String,
      enum: [
        "EXPECTED_COMPUTED",
        "MERCHANT_SUBMITTED",
        "ADMIN_VERIFIED",
        "ADMIN_DISPUTED",
        "ADMIN_CLOSED",
        "RESET_TO_OPEN",
      ],
      required: true,
      index: true,
    },
    before: { type: Object, default: null },
    after: { type: Object, default: null },
    note: { type: String, trim: true, maxlength: 280, default: null },
    meta: {
      type: Object,
      default: null,
    },
  },
  {
    collection: "cashcollectionaudits",
    timestamps: true,
  }
);

CashCollectionAuditSchema.index({ weekKey: 1, createdAt: -1 });
CashCollectionAuditSchema.index({ businessId: 1, weekKey: 1, createdAt: -1 });

export const CashCollectionAudit =
  models.CashCollectionAudit || model("CashCollectionAudit", CashCollectionAuditSchema);
