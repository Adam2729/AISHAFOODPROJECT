import { Schema, model, models } from "mongoose";

const ProductSchema = new Schema(
  {
    businessId: { type: Schema.Types.ObjectId, ref: "Business", required: true, index: true },
    name: { type: String, required: true, trim: true },
    category: { type: String, default: "", trim: true, index: true },
    description: { type: String, default: "" },
    price: { type: Number, required: true, min: 0 },
    imageUrl: { type: String, default: "" },
    isAvailable: { type: Boolean, default: true, index: true },
    unavailableReason: {
      type: String,
      enum: ["out_of_stock", "busy", "closed", null],
      default: null,
    },
    unavailableUpdatedAt: { type: Date, default: null },
    lastSoldAt: { type: Date, default: null },
    stockHint: {
      type: String,
      enum: ["in_stock", "low", "out"],
      default: "in_stock",
      index: true,
    },
  },
  { timestamps: true }
);

ProductSchema.index({ businessId: 1, isAvailable: 1 });
ProductSchema.index({ businessId: 1, lastSoldAt: -1 });
ProductSchema.index(
  { name: "text", category: "text" },
  { name: "product_text_idx", weights: { name: 10, category: 3 } }
);

export const Product = models.Product || model("Product", ProductSchema);
