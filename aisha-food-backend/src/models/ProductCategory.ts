import { Schema, model, models } from "mongoose";

const ProductCategorySchema = new Schema(
  {
    businessId: { type: Schema.Types.ObjectId, ref: "Business", required: true, index: true },
    name: { type: String, required: true, trim: true, maxlength: 80 },
    normalizedName: { type: String, required: true, trim: true, lowercase: true, maxlength: 80 },
    isArchived: { type: Boolean, default: false, index: true },
    archivedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

ProductCategorySchema.index({ businessId: 1, normalizedName: 1, isArchived: 1 });
ProductCategorySchema.index({ businessId: 1, isArchived: 1, name: 1 });

const existingProductCategoryModel = models.ProductCategory;
if (existingProductCategoryModel) {
  const existingSchema = existingProductCategoryModel.schema as Schema & {
    __productCategorySchemaMerged?: boolean;
    add?: (obj: Record<string, unknown>) => unknown;
    path?: (name: string) => unknown;
  };
  const needsArchiveMerge =
    !existingSchema.path?.("normalizedName") ||
    !existingSchema.path?.("isArchived") ||
    !existingSchema.path?.("archivedAt");
  if (!existingSchema.__productCategorySchemaMerged || needsArchiveMerge) {
    const schemaObj = (ProductCategorySchema as unknown as { obj: Record<string, unknown> }).obj;
    existingSchema.add?.(schemaObj);
    existingSchema.__productCategorySchemaMerged = true;
  }
}

export const ProductCategory =
  existingProductCategoryModel || model("ProductCategory", ProductCategorySchema);
