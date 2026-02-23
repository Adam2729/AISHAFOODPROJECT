import { Schema, model, models } from "mongoose";
import { COMMISSION_RATE_DEFAULT } from "@/lib/constants";

const OrderItemSchema = new Schema(
  {
    productId: { type: Schema.Types.ObjectId, ref: "Product", required: true },
    name: { type: String, required: true },
    productPrice: { type: Number, required: true, min: 0 },
    qty: { type: Number, required: true, min: 1 },
    unitPrice: { type: Number, required: true, min: 0 },
    lineTotal: { type: Number, required: true, min: 0 },
  },
  { _id: false }
);

const OrderSchema = new Schema(
  {
    orderNumber: { type: String, required: true, unique: true, index: true },
    businessId: { type: Schema.Types.ObjectId, ref: "Business", required: true, index: true },
    businessName: { type: String, required: true },
    businessType: { type: String, enum: ["restaurant", "colmado"], required: true },

    customerName: { type: String, required: true },
    phone: { type: String, required: true },
    address: { type: String, required: true },
    customerLocation: {
      lat: { type: Number, required: true },
      lng: { type: Number, required: true },
    },

    items: { type: [OrderItemSchema], required: true, default: [] },

    subtotal: { type: Number, required: true, min: 0 },
    deliveryFeeToCustomer: { type: Number, default: 0 },
    total: { type: Number, required: true, min: 0 },
    commissionRate: { type: Number, default: COMMISSION_RATE_DEFAULT },
    commissionAmount: { type: Number, required: true, min: 0 },

    payment: {
      method: { type: String, enum: ["cash"], default: "cash" },
      status: { type: String, enum: ["unpaid", "paid"], default: "unpaid" },
    },
    paymentStatus: { type: String, enum: ["unpaid", "paid"], default: "unpaid" }, // legacy shortcut

    status: {
      type: String,
      enum: ["new", "accepted", "preparing", "ready", "out_for_delivery", "delivered", "cancelled"],
      default: "new",
      index: true,
    },
    cancelReason: { type: String, default: "" },

    settlement: {
      weekKey: { type: String, required: true, index: true },
      status: { type: String, enum: ["pending", "collected"], default: "pending" },
      counted: { type: Boolean, default: false },
      collectedAt: { type: Date, default: null },
    },
  },
  { timestamps: true }
);

OrderSchema.index({ businessId: 1, createdAt: -1 });
OrderSchema.index({ businessId: 1, status: 1 });
OrderSchema.index({ createdAt: -1 });
OrderSchema.index({ "settlement.weekKey": 1, businessId: 1 });

export const Order = models.Order || model("Order", OrderSchema);
