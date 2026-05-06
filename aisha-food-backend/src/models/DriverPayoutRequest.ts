import { Schema, model, models } from "mongoose";
import { PAYOUT_METHODS } from "@/lib/merchantOnboarding";

const DriverPayoutRequestSchema = new Schema(
  {
    cityId: { type: Schema.Types.ObjectId, ref: "City", default: null, index: true },
    driverId: { type: Schema.Types.ObjectId, ref: "Driver", required: true, index: true },
    driverName: { type: String, required: true, trim: true, maxlength: 120 },
    currency: { type: String, default: "XOF", trim: true, maxlength: 12 },
    requestedAmount: { type: Number, required: true, min: 0 },
    availableBalanceAtRequest: { type: Number, required: true, min: 0 },
    payoutMethod: {
      type: String,
      enum: PAYOUT_METHODS,
      default: "cash",
    },
    payoutAccountName: { type: String, default: "", trim: true, maxlength: 120 },
    payoutAccountNumber: { type: String, default: "", trim: true, maxlength: 120 },
    payoutNotes: { type: String, default: "", trim: true, maxlength: 400 },
    status: {
      type: String,
      enum: ["requested", "approved", "paid", "rejected", "cancelled"],
      default: "requested",
      index: true,
    },
    orderIds: [{ type: Schema.Types.ObjectId, ref: "Order", default: [] }],
    riderPayoutIds: [{ type: Schema.Types.ObjectId, ref: "RiderPayout", default: [] }],
    deliveryCount: { type: Number, default: 0, min: 0 },
    requestedAt: { type: Date, default: Date.now },
    approvedAt: { type: Date, default: null },
    paidAt: { type: Date, default: null },
    rejectedAt: { type: Date, default: null },
    reviewedBy: { type: String, default: "", trim: true, maxlength: 80 },
    payoutReference: { type: String, default: "", trim: true, maxlength: 160 },
    adminNote: { type: String, default: "", trim: true, maxlength: 500 },
    rejectionReason: { type: String, default: "", trim: true, maxlength: 280 },
    archivedAt: { type: Date, default: null, index: true },
    archivedBy: { type: String, default: "", trim: true, maxlength: 80 },
    archivedReason: { type: String, default: "", trim: true, maxlength: 280 },
  },
  { timestamps: true, collection: "driverpayoutrequests" }
);

DriverPayoutRequestSchema.index({ driverId: 1, requestedAt: -1 });
DriverPayoutRequestSchema.index({ cityId: 1, status: 1, requestedAt: -1 });
DriverPayoutRequestSchema.index({ archivedAt: 1, status: 1, requestedAt: -1 });

export const DriverPayoutRequest =
  models.DriverPayoutRequest ||
  model("DriverPayoutRequest", DriverPayoutRequestSchema);
