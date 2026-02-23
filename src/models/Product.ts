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
  },
  { timestamps: true }
);

ProductSchema.index({ businessId: 1, isAvailable: 1 });

export const Product = models.Product || model("Product", ProductSchema);
