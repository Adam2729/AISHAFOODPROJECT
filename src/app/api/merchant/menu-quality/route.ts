import mongoose from "mongoose";
import { dbConnect } from "@/lib/mongodb";
import { ok, fail } from "@/lib/apiResponse";
import { requireMerchantSession } from "@/lib/merchantAuth";
import { requireMerchantBusinessAvailable } from "@/lib/merchantBusiness";
import { getNumberSetting } from "@/lib/appSettings";
import { computeMenuQualityForBusiness } from "@/lib/menuQuality";
import { Business } from "@/models/Business";

type ApiError = Error & { status?: number; code?: string };

type BusinessLean = {
  _id: mongoose.Types.ObjectId;
  paused?: boolean;
  pausedReason?: string;
  menuQuality?: {
    productsTotalCount?: number;
    productsActiveCount?: number;
    productsWithImageCount?: number;
    categoriesCount?: number;
    hasMinProducts?: boolean;
    score?: number;
    updatedAt?: Date | null;
  };
};

function toNumber(value: unknown) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

export async function GET(req: Request) {
  try {
    const session = requireMerchantSession(req);
    await dbConnect();
    await requireMerchantBusinessAvailable(session.businessId);

    const [minProductsRequired, minScore, business] = await Promise.all([
      getNumberSetting("min_products_required", 10),
      getNumberSetting("menu_quality_min_score", 60),
      Business.findById(new mongoose.Types.ObjectId(session.businessId))
        .select("paused pausedReason menuQuality")
        .lean<BusinessLean | null>(),
    ]);

    if (!business) {
      return fail("NOT_FOUND", "Business not found.", 404);
    }

    const snapshotExists =
      business.menuQuality && business.menuQuality.updatedAt != null;
    const quality = snapshotExists
      ? {
          productsTotalCount: Math.max(0, toNumber(business.menuQuality?.productsTotalCount)),
          productsActiveCount: Math.max(0, toNumber(business.menuQuality?.productsActiveCount)),
          productsWithImageCount: Math.max(0, toNumber(business.menuQuality?.productsWithImageCount)),
          categoriesCount: Math.max(0, toNumber(business.menuQuality?.categoriesCount)),
          hasMinProducts: Boolean(business.menuQuality?.hasMinProducts),
          menuQualityScore: Math.max(0, Math.min(100, Math.round(toNumber(business.menuQuality?.score)))),
          updatedAt:
            business.menuQuality?.updatedAt &&
            !Number.isNaN(new Date(business.menuQuality.updatedAt).getTime())
              ? new Date(business.menuQuality.updatedAt).toISOString()
              : null,
        }
      : {
          ...(await computeMenuQualityForBusiness(session.businessId)),
          updatedAt: null,
        };

    const minProducts = Math.max(1, Math.round(Number(minProductsRequired || 10)));
    const safeMinScore = Math.max(0, Math.min(100, Math.round(Number(minScore || 60))));
    const missingProducts = Math.max(0, minProducts - Number(quality.productsActiveCount || 0));
    const missingImages = Math.max(
      0,
      Number(quality.productsActiveCount || 0) - Number(quality.productsWithImageCount || 0)
    );
    const missingCategories = Math.max(0, 3 - Number(quality.categoriesCount || 0));

    return ok({
      menuQuality: quality,
      targets: {
        minProductsRequired: minProducts,
        minScore: safeMinScore,
      },
      checklist: {
        addProducts: missingProducts > 0,
        addImages: missingImages > 0,
        addCategories: missingCategories > 0,
        missingProducts,
        missingImages,
        missingCategories,
      },
      paused: Boolean(business.paused),
      pausedReason: String(business.pausedReason || ""),
    });
  } catch (error: unknown) {
    const err = error as ApiError;
    return fail(
      err.code || "SERVER_ERROR",
      err.message || "Could not load menu quality.",
      err.status || 500
    );
  }
}
