import { Schema, model, models } from "mongoose";

const ProductSchema = new Schema(
  {
    businessId: { type: Schema.Types.ObjectId, ref: "Business", required: true, index: true },
    name: { type: String, required: true, trim: true },
    category: { type: String, default: "", trim: true, index: true },
    description: { type: String, default: "" },
    price: { type: Number, required: true, min: 0 },
    imageUrl: { type: String, default: "" },
    imageSource: { type: String, enum: ["external", "upload", null], default: null },
    imageUpdatedAt: { type: Date, default: null },
    quantityValue: { type: Number, default: null, min: 0 },
    quantityUnit: {
      type: String,
      enum: ["kg", "g", "litre", "ml", "piece", "pack", "bottle", "can", "box", ""],
      default: "",
      trim: true,
    },
    displaySize: { type: String, default: "", trim: true, maxlength: 40 },
    isAvailable: { type: Boolean, default: true, index: true },
    unavailableReason: {
      type: String,
      enum: ["out_of_stock", "busy", "closed", null],
      default: null,
    },
    isArchived: { type: Boolean, default: false, index: true },
    archivedAt: { type: Date, default: null },
    archivedReason: { type: String, default: "", trim: true, maxlength: 160 },
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
ProductSchema.index({ businessId: 1, isArchived: 1, isAvailable: 1 });
ProductSchema.index({ businessId: 1, category: 1, isArchived: 1 });
ProductSchema.index({ businessId: 1, lastSoldAt: -1 });
ProductSchema.index(
  { name: "text", category: "text" },
  { name: "product_text_idx", weights: { name: 10, category: 3 } }
);

const existingProductModel = models.Product;
if (existingProductModel) {
  const existingSchema = existingProductModel.schema as Schema & {
    __productSchemaMerged?: boolean;
    add?: (obj: Record<string, unknown>) => unknown;
    path?: (name: string) => unknown;
  };
  const needsCatalogMetadataMerge =
    !existingSchema.path?.("imageSource") ||
    !existingSchema.path?.("imageUpdatedAt") ||
    !existingSchema.path?.("quantityValue") ||
    !existingSchema.path?.("quantityUnit") ||
    !existingSchema.path?.("displaySize") ||
    !existingSchema.path?.("isArchived") ||
    !existingSchema.path?.("archivedAt") ||
    !existingSchema.path?.("archivedReason");
  if (!existingSchema.__productSchemaMerged || needsCatalogMetadataMerge) {
    const schemaObj = (ProductSchema as unknown as { obj: Record<string, unknown> }).obj;
    existingSchema.add?.(schemaObj);
    existingSchema.__productSchemaMerged = true;
  }
}

export const Product = existingProductModel || model("Product", ProductSchema);
