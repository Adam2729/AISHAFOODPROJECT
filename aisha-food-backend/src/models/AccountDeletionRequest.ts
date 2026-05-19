import { Schema, model, models } from "mongoose";

const ACCOUNT_TYPES = ["customer", "driver", "merchant"] as const;
const REQUEST_STATUSES = ["pending", "processing", "completed"] as const;

const AccountDeletionRequestSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    email_or_phone: { type: String, required: true, trim: true, maxlength: 160, index: true },
    accountType: {
      type: String,
      enum: ACCOUNT_TYPES,
      required: true,
      default: "customer",
      index: true,
    },
    reason: { type: String, default: "", trim: true, maxlength: 1000 },
    status: {
      type: String,
      enum: REQUEST_STATUSES,
      default: "pending",
      index: true,
    },
  },
  { timestamps: true, collection: "accountdeletionrequests" }
);

AccountDeletionRequestSchema.index({ status: 1, createdAt: -1 });
AccountDeletionRequestSchema.index({ accountType: 1, createdAt: -1 });

export const AccountDeletionRequest =
  models.AccountDeletionRequest ||
  model("AccountDeletionRequest", AccountDeletionRequestSchema);
