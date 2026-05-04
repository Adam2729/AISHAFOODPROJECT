import { Schema, model, models } from "mongoose";

const ComplaintSchema = new Schema(
  {
    orderId: { type: Schema.Types.ObjectId, ref: "Order", required: true, index: true },
    orderNumber: { type: String, required: true, trim: true, index: true },
    businessId: { type: Schema.Types.ObjectId, ref: "Business", required: true, index: true },
    businessName: { type: String, required: true, trim: true },
    phoneHash: { type: String, required: true, trim: true, index: true },
    type: {
      type: String,
      enum: ["late", "wrong_item", "no_response", "other"],
      required: true,
      index: true,
    },
    message: { type: String, required: true, trim: true, maxlength: 300 },
    status: { type: String, enum: ["open", "resolved"], default: "open", index: true },
    resolvedAt: { type: Date, default: null },
    resolvedBy: { type: String, default: null, trim: true, maxlength: 60 },
    resolutionNote: { type: String, default: null, trim: true, maxlength: 300 },
  },
  { timestamps: true, collection: "complaints" }
);

ComplaintSchema.index({ status: 1, createdAt: -1 });
ComplaintSchema.index({ businessId: 1, status: 1, createdAt: -1 });
ComplaintSchema.index({ orderId: 1 }, { unique: true });

export const Complaint = models.Complaint || model("Complaint", ComplaintSchema);

