import { Schema, model, models } from "mongoose";

const StatementArchiveSchema = new Schema(
  {
    businessId: { type: Schema.Types.ObjectId, ref: "Business", required: true, index: true },
    businessName: { type: String, required: true, trim: true },
    weekKey: { type: String, required: true, index: true },
    version: { type: Number, required: true, default: 1 },
    packHash: { type: String, required: true, index: true },
    pack: { type: Object, required: true },
    pdfBase64: { type: String, default: null },
    generatedAt: { type: Date, default: Date.now, index: true },
    generatedBy: { type: String, enum: ["cron", "admin", "merchant"], default: "admin" },
    locked: { type: Boolean, default: false, index: true },
    lockedAt: { type: Date, default: null },
  },
  { timestamps: true, collection: "statementarchives" }
);

StatementArchiveSchema.index({ businessId: 1, weekKey: 1, version: 1 }, { unique: true });
StatementArchiveSchema.index({ generatedAt: -1 });
StatementArchiveSchema.index({ businessId: 1, weekKey: 1, packHash: 1 });

export const StatementArchive = models.StatementArchive || model("StatementArchive", StatementArchiveSchema);
