import mongoose from "mongoose";
import { dbConnect } from "@/lib/mongodb";
import { getNumberSetting } from "@/lib/appSettings";
import { Product } from "@/models/Product";

export type MenuQuality = {
  productsTotalCount: number;
  productsActiveCount: number;
  productsWithImageCount: number;
  categoriesCount: number;
  hasMinProducts: boolean;
  menuQualityScore: number;
};

type QualityAgg = {
  _id: mongoose.Types.ObjectId;
  productsTotalCount: number;
  productsActiveCount: number;
  productsWithImageCount: number;
  categoriesCount: number;
};

function toNumber(value: unknown) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function normalizeBusinessIds(businessIds: Array<string | mongoose.Types.ObjectId>) {
  const seen = new Set<string>();
  const ids: mongoose.Types.ObjectId[] = [];
  for (const raw of businessIds) {
    const id = String(raw || "").trim();
    if (!mongoose.Types.ObjectId.isValid(id) || seen.has(id)) continue;
    seen.add(id);
    ids.push(new mongoose.Types.ObjectId(id));
  }
  return ids;
}

export function scoreMenuQuality(
  quality: Omit<MenuQuality, "menuQualityScore">,
  minProductsRequired: number
) {
  const safeMinProductsRequired = Math.max(1, Math.round(toNumber(minProductsRequired) || 10));
  const productsActiveCount = Math.max(0, toNumber(quality.productsActiveCount));
  const productsTotalCount = Math.max(0, toNumber(quality.productsTotalCount));
  const productsWithImageCount = Math.max(0, toNumber(quality.productsWithImageCount));
  const categoriesCount = Math.max(0, toNumber(quality.categoriesCount));
  const hasMinProducts = productsActiveCount >= safeMinProductsRequired;

  const productsScore = hasMinProducts
    ? 40
    : clamp((productsActiveCount / safeMinProductsRequired) * 40, 0, 40);
  const imageCoverage = productsWithImageCount / Math.max(productsActiveCount, 1);
  const imageScore = clamp(imageCoverage * 30, 0, 30);
  const categoryScore = clamp((Math.min(categoriesCount, 6) / 6) * 20, 0, 20);
  const availabilityCoverage = productsActiveCount / Math.max(productsTotalCount, 1);
  const availabilityScore = clamp(availabilityCoverage * 10, 0, 10);
  const rawScore = productsScore + imageScore + categoryScore + availabilityScore;

  return Math.round(clamp(rawScore, 0, 100));
}

function buildQuality(
  aggRow: Partial<QualityAgg> | null | undefined,
  minProductsRequired: number
): MenuQuality {
  const productsTotalCount = Math.max(0, toNumber(aggRow?.productsTotalCount));
  const productsActiveCount = Math.max(0, toNumber(aggRow?.productsActiveCount));
  const productsWithImageCount = Math.max(0, toNumber(aggRow?.productsWithImageCount));
  const categoriesCount = Math.max(0, toNumber(aggRow?.categoriesCount));
  const hasMinProducts = productsActiveCount >= Math.max(1, Math.round(minProductsRequired || 10));

  const base = {
    productsTotalCount,
    productsActiveCount,
    productsWithImageCount,
    categoriesCount,
    hasMinProducts,
  };

  return {
    ...base,
    menuQualityScore: scoreMenuQuality(base, minProductsRequired),
  };
}

async function computeFromAggregation(
  objectIds: mongoose.Types.ObjectId[]
): Promise<Map<string, Omit<MenuQuality, "menuQualityScore" | "hasMinProducts">>> {
  const byBusiness = new Map<
    string,
    Omit<MenuQuality, "menuQualityScore" | "hasMinProducts">
  >();
  if (!objectIds.length) return byBusiness;

  const agg = await Product.aggregate<QualityAgg>([
    {
      $match: {
        businessId: { $in: objectIds },
      },
    },
    {
      $project: {
        businessId: 1,
        isAvailable: { $eq: ["$isAvailable", true] },
        hasImage: {
          $gt: [{ $strLenCP: { $trim: { input: { $ifNull: ["$imageUrl", ""] } } } }, 0],
        },
        categoryNormalized: { $trim: { input: { $ifNull: ["$category", ""] } } },
      },
    },
    {
      $group: {
        _id: "$businessId",
        productsTotalCount: { $sum: 1 },
        productsActiveCount: { $sum: { $cond: ["$isAvailable", 1, 0] } },
        productsWithImageCount: { $sum: { $cond: ["$hasImage", 1, 0] } },
        categories: { $addToSet: "$categoryNormalized" },
      },
    },
    {
      $project: {
        productsTotalCount: 1,
        productsActiveCount: 1,
        productsWithImageCount: 1,
        categoriesCount: {
          $size: {
            $filter: {
              input: "$categories",
              as: "category",
              cond: {
                $gt: [{ $strLenCP: "$$category" }, 0],
              },
            },
          },
        },
      },
    },
  ]);

  for (const row of agg) {
    byBusiness.set(String(row._id), {
      productsTotalCount: Math.max(0, toNumber(row.productsTotalCount)),
      productsActiveCount: Math.max(0, toNumber(row.productsActiveCount)),
      productsWithImageCount: Math.max(0, toNumber(row.productsWithImageCount)),
      categoriesCount: Math.max(0, toNumber(row.categoriesCount)),
    });
  }

  return byBusiness;
}

export async function computeMenuQualityForBusinesses(
  businessIds: Array<string | mongoose.Types.ObjectId>
): Promise<Map<string, MenuQuality>> {
  await dbConnect();
  const minProductsRequired = await getNumberSetting("min_products_required", 10);
  const ids = normalizeBusinessIds(businessIds);
  const aggregated = await computeFromAggregation(ids);
  const result = new Map<string, MenuQuality>();

  for (const objectId of ids) {
    const key = String(objectId);
    const aggRow = aggregated.get(key);
    result.set(key, buildQuality(aggRow, minProductsRequired));
  }

  return result;
}

export async function computeMenuQualityForBusiness(
  businessId: string | mongoose.Types.ObjectId
): Promise<MenuQuality> {
  const map = await computeMenuQualityForBusinesses([businessId]);
  return (
    map.get(String(businessId)) || {
      productsTotalCount: 0,
      productsActiveCount: 0,
      productsWithImageCount: 0,
      categoriesCount: 0,
      hasMinProducts: false,
      menuQualityScore: 0,
    }
  );
}
