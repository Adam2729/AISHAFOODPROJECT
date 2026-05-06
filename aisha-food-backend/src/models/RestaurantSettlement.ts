import { Schema, model, models } from "mongoose";
import { PAYOUT_METHODS } from "@/lib/merchantOnboarding";

const RestaurantSettlementSchema = new Schema(
  {
    cityId: { type: Schema.Types.ObjectId, ref: "City", default: null, index: true },
    merchantId: { type: Schema.Types.ObjectId, ref: "Business", required: true, index: true },
    restaurantName: { type: String, required: true, trim: true, maxlength: 160 },
    settlementDate: { type: String, required: true, trim: true, maxlength: 10, index: true },
    periodStart: { type: Date, required: true },
    periodEnd: { type: Date, required: true },
    currency: { type: String, default: "XOF", trim: true, maxlength: 12 },
    grossSales: { type: Number, default: 0, min: 0 },
    platformCommission: { type: Number, default: 0, min: 0 },
    deliveryFeesCollected: { type: Number, default: 0, min: 0 },
    restaurantNet: { type: Number, default: 0, min: 0 },
    orderCount: { type: Number, default: 0, min: 0 },
    paidOrderIds: [{ type: Schema.Types.ObjectId, ref: "Order", default: [] }],
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
      enum: ["pending", "paid", "failed", "cancelled"],
      default: "pending",
      index: true,
    },
    paidAt: { type: Date, default: null },
    paidBy: { type: String, default: "", trim: true, maxlength: 80 },
    payoutReference: { type: String, default: "", trim: true, maxlength: 160 },
    adminNote: { type: String, default: "", trim: true, maxlength: 500 },
    archivedAt: { type: Date, default: null, index: true },
    archivedBy: { type: String, default: "", trim: true, maxlength: 80 },
    archivedReason: { type: String, default: "", trim: true, maxlength: 280 },
  },
  { timestamps: true, collection: "restaurantsettlements" }
);

RestaurantSettlementSchema.index({ merchantId: 1, settlementDate: 1 }, { unique: true });
RestaurantSettlementSchema.index({ cityId: 1, settlementDate: 1, status: 1 });
RestaurantSettlementSchema.index({ archivedAt: 1, settlementDate: -1 });

export const RestaurantSettlement =
  models.RestaurantSettlement ||
  model("RestaurantSettlement", RestaurantSettlementSchema);
