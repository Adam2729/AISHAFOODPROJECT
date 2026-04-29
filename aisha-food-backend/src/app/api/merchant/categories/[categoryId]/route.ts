import mongoose from "mongoose";
import { dbConnect } from "@/lib/mongodb";
import { ok, fail, readJson } from "@/lib/apiResponse";
import { requireMerchantSession } from "@/lib/merchantAuth";
import { requireMerchantBusinessAvailable } from "@/lib/merchantBusiness";
import { normalizeCategoryKey, normalizeProductCategory } from "@/lib/productCatalog";
import { Product } from "@/models/Product";
import { ProductCategory } from "@/models/ProductCategory";

type ApiError = Error & { status?: number; code?: string };
type CategoryBody = {
  name?: string;
};

function serializeCategory(category: {
  _id?: mongoose.Types.ObjectId | string;
  name?: string;
  isArchived?: boolean;
  archivedAt?: Date | string | null;
  updatedAt?: Date | string | null;
}) {
  return {
    id: category._id ? String(category._id) : "",
    name: normalizeProductCategory(category.name),
    isArchived: Boolean(category.isArchived),
    archivedAt: category.archivedAt || null,
    updatedAt: category.updatedAt || null,
  };
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ categoryId: string }> }
) {
  try {
    const session = requireMerchantSession(req);
    const { categoryId } = await params;
    if (!mongoose.Types.ObjectId.isValid(categoryId)) {
      return fail("VALIDATION_ERROR", "Invalid categoryId.", 400);
    }

    const body = await readJson<CategoryBody>(req);
    const name = normalizeProductCategory(body.name);
    if (!name) return fail("VALIDATION_ERROR", "Category name is required.", 400);
    const normalizedName = normalizeCategoryKey(name);
    const businessId = new mongoose.Types.ObjectId(session.businessId);

    await dbConnect();
    await requireMerchantBusinessAvailable(session.businessId);

    const category = await ProductCategory.findOne({
      _id: new mongoose.Types.ObjectId(categoryId),
      businessId,
      isArchived: { $ne: true },
    });
    if (!category) return fail("NOT_FOUND", "Category not found.", 404);

    const duplicate = await ProductCategory.findOne({
      _id: { $ne: category._id },
      businessId,
      normalizedName,
      isArchived: { $ne: true },
    })
      .select("_id")
      .lean();
    if (duplicate) {
      return fail("DUPLICATE_CATEGORY", "Category already exists.", 409);
    }

    const oldName = normalizeProductCategory(category.name);
    category.name = name;
    category.normalizedName = normalizedName;
    await category.save();
    if (oldName && oldName !== name) {
      await Product.updateMany(
        {
          businessId,
          category: oldName,
          isArchived: { $ne: true },
        },
        { $set: { category: name } }
      );
    }

    return ok({ category: serializeCategory(category) });
  } catch (error: unknown) {
    const err = error as ApiError;
    return fail(
      err.code || "SERVER_ERROR",
      err.message || "Could not update category.",
      err.status || 500
    );
  }
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ categoryId: string }> }
) {
  try {
    const session = requireMerchantSession(req);
    const { categoryId } = await params;
    if (!mongoose.Types.ObjectId.isValid(categoryId)) {
      return fail("VALIDATION_ERROR", "Invalid categoryId.", 400);
    }

    await dbConnect();
    await requireMerchantBusinessAvailable(session.businessId);

    const category = await ProductCategory.findOneAndUpdate(
      {
        _id: new mongoose.Types.ObjectId(categoryId),
        businessId: new mongoose.Types.ObjectId(session.businessId),
      },
      {
        $set: {
          isArchived: true,
          archivedAt: new Date(),
        },
      },
      { returnDocument: "after" }
    ).lean();
    if (!category) return fail("NOT_FOUND", "Category not found.", 404);

    return ok({
      archived: true,
      category: serializeCategory(category),
      productCategoryStrategy: "Products keep the old category label until reassigned.",
    });
  } catch (error: unknown) {
    const err = error as ApiError;
    return fail(
      err.code || "SERVER_ERROR",
      err.message || "Could not archive category.",
      err.status || 500
    );
  }
}
