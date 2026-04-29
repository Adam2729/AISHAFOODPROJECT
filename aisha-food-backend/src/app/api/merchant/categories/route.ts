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

export async function GET(req: Request) {
  try {
    const session = requireMerchantSession(req);
    const url = new URL(req.url);
    const includeArchived = url.searchParams.get("includeArchived") === "true";
    const businessId = new mongoose.Types.ObjectId(session.businessId);

    await dbConnect();
    await requireMerchantBusinessAvailable(session.businessId);

    const [storedCategories, productCategories] = await Promise.all([
      ProductCategory.find({
        businessId,
        ...(includeArchived ? {} : { isArchived: { $ne: true } }),
      })
        .sort({ isArchived: 1, name: 1 })
        .lean(),
      Product.distinct("category", {
        businessId,
        isArchived: { $ne: true },
      }),
    ]);

    const storedKeys = new Set(
      storedCategories.map((category) => normalizeCategoryKey(category.name)).filter(Boolean)
    );
    const derived = productCategories
      .map((category) => normalizeProductCategory(category))
      .filter((category) => category && !storedKeys.has(normalizeCategoryKey(category)))
      .sort((a, b) => a.localeCompare(b, "fr"));

    return ok({
      categories: [
        ...storedCategories.map(serializeCategory),
        ...derived.map((name) => ({
          id: "",
          name,
          isArchived: false,
          archivedAt: null,
          updatedAt: null,
          source: "product",
        })),
      ],
    });
  } catch (error: unknown) {
    const err = error as ApiError;
    return fail(
      err.code || "SERVER_ERROR",
      err.message || "Could not load categories.",
      err.status || 500
    );
  }
}

export async function POST(req: Request) {
  try {
    const session = requireMerchantSession(req);
    const body = await readJson<CategoryBody>(req);
    const name = normalizeProductCategory(body.name);
    if (!name) return fail("VALIDATION_ERROR", "Category name is required.", 400);
    const normalizedName = normalizeCategoryKey(name);
    const businessId = new mongoose.Types.ObjectId(session.businessId);

    await dbConnect();
    await requireMerchantBusinessAvailable(session.businessId);
    const duplicate = await ProductCategory.findOne({
      businessId,
      normalizedName,
      isArchived: { $ne: true },
    })
      .select("_id")
      .lean();
    if (duplicate) {
      return fail("DUPLICATE_CATEGORY", "Category already exists.", 409);
    }

    const category = await ProductCategory.create({
      businessId,
      name,
      normalizedName,
      isArchived: false,
      archivedAt: null,
    });
    return ok({ category: serializeCategory(category) }, 201);
  } catch (error: unknown) {
    const err = error as ApiError;
    return fail(
      err.code || "SERVER_ERROR",
      err.message || "Could not create category.",
      err.status || 500
    );
  }
}
