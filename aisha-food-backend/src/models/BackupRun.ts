import { Schema, model, models } from "mongoose";

const BackupRunSchema = new Schema(
  {
    kind: {
      type: String,
      enum: ["orders", "settlements", "cashCollections", "all"],
      required: true,
      index: true,
    },
    status: {
      type: String,
      enum: ["running", "success", "failed"],
      required: true,
      index: true,
    },
    startedAt: { type: Date, required: true },
    finishedAt: { type: Date, default: null },
    counts: {
      orders: { type: Number, default: 0 },
      settlements: { type: Number, default: 0 },
      cashCollections: { type: Number, default: 0 },
    },
    fileMeta: {
      filename: { type: String, default: "" },
      sizeBytes: { type: Number, default: 0 },
    },
    errorMessage: { type: String, default: null, trim: true, maxlength: 500 },
  },
  { timestamps: true, collection: "backupruns" }
);

BackupRunSchema.index({ createdAt: -1 });

export const BackupRun = models.BackupRun || model("BackupRun", BackupRunSchema);
