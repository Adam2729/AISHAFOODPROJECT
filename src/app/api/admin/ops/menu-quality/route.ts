import mongoose from "mongoose";
import { dbConnect } from "@/lib/mongodb";
import { ok, fail } from "@/lib/apiResponse";
import { requireAdminKey } from "@/lib/adminAuth";
import { getBoolSetting, getNumberSetting, getStringSetting } from "@/lib/appSettings";
import { isBusinessOpenNow } from "@/lib/businessHours";
import { computeMenuQualityForBusinesses, type MenuQuality } from "@/lib/menuQuality";
import { Business } from "@/models/Business";

type ApiError = Error & { status?: number; code?: string };

type BusinessRow = {
  _id: mongoose.Types.ObjectId;
  name?: string;
  type?: string;
  isActive?: boolean;
  paused?: boolean;
  pausedReason?: string;
  isManuallyPaused?: boolean;
  busyUntil?: Date | null;
  performance?: { tier?: string };
  hours?: {
    timezone?: string | null;
    weekly?: Record<string, unknown> | null;
  } | null;
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

function toQualityRow(business: BusinessRow) {
  return {
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
  };
}

export async function GET(req: Request) {
  try {
    requireAdminKey(req);
    await dbConnect();

    const [
      minProductsRequired,
      minScore,
      pauseEnabled,
      pauseThreshold,
      autoHideEnabled,
      autoHideDays,
      autoHideNeverSoldEnabled,
      autoHideLastRunAt,
      autoHideLastScanned,
      autoHideLastHidden,
    ] = await Promise.all([
      getNumberSetting("min_products_required", 10),
      getNumberSetting("menu_quality_min_score", 60),
      getBoolSetting("menu_quality_pause_enabled", false),
      getNumberSetting("menu_quality_pause_threshold", 40),
      getBoolSetting("auto_hide_enabled", true),
      getNumberSetting("auto_hide_days", 30),
      getBoolSetting("auto_hide_never_sold_enabled", true),
      getStringSetting("auto_hide_last_run_at", ""),
      getNumberSetting("auto_hide_last_scanned", 0),
      getNumberSetting("auto_hide_last_hidden", 0),
    ]);

    const businesses = await Business.find({
      isActive: true,
      isDemo: { $ne: true },
    })
      .select("name type isActive paused pausedReason isManuallyPaused busyUntil performance.tier hours menuQuality")
      .lean<BusinessRow[]>();

    const missingSnapshotIds = businesses
      .filter((row) => row.menuQuality?.updatedAt == null)
      .map((row) => row._id);
    const fallbackMap: Map<string, MenuQuality> = missingSnapshotIds.length
      ? await computeMenuQualityForBusinesses(missingSnapshotIds)
      : new Map<string, MenuQuality>();

    const rows = businesses.map((business) => {
      const fallback = fallbackMap.get(String(business._id));
      const quality = fallback
        ? {
            productsTotalCount: fallback.productsTotalCount,
            productsActiveCount: fallback.productsActiveCount,
            productsWithImageCount: fallback.productsWithImageCount,
            categoriesCount: fallback.categoriesCount,
            hasMinProducts: fallback.hasMinProducts,
            menuQualityScore: fallback.menuQualityScore,
            updatedAt: null,
          }
        : toQualityRow(business);
      const openStatus = isBusinessOpenNow(business);

      return {
        businessId: String(business._id),
        businessName: String(business.name || "Business"),
        type: String(business.type || "restaurant"),
        isActive: Boolean(business.isActive),
        isPaused: Boolean(business.paused),
        pausedReason: String(business.pausedReason || ""),
        isOpenNow: Boolean(openStatus.open),
        closedReason: openStatus.open ? null : openStatus.reason || null,
        nextOpenText: openStatus.open ? null : openStatus.nextOpenText || null,
        performanceTier: String(business.performance?.tier || "bronze"),
        menuQuality: quality,
      };
    });

    const listTop = [...rows]
      .sort((a, b) => {
        const scoreDiff = b.menuQuality.menuQualityScore - a.menuQuality.menuQualityScore;
        if (scoreDiff !== 0) return scoreDiff;
        return a.businessName.localeCompare(b.businessName, "es");
      })
      .slice(0, 25);

    const listAtRisk = [...rows]
      .sort((a, b) => {
        const scoreDiff = a.menuQuality.menuQualityScore - b.menuQuality.menuQualityScore;
        if (scoreDiff !== 0) return scoreDiff;
        return a.businessName.localeCompare(b.businessName, "es");
      })
      .slice(0, 25);

    const avgScore =
      rows.length > 0
        ? Number(
            (
              rows.reduce((sum, row) => sum + Number(row.menuQuality.menuQualityScore || 0), 0) /
              rows.length
            ).toFixed(2)
          )
        : 0;
    const belowMinScoreCount = rows.filter(
      (row) => Number(row.menuQuality.menuQualityScore || 0) < Number(minScore || 60)
    ).length;
    const belowPauseThresholdCount = rows.filter(
      (row) => Number(row.menuQuality.menuQualityScore || 0) < Number(pauseThreshold || 40)
    ).length;

    return ok({
      minProductsRequired: Math.max(1, Math.round(Number(minProductsRequired || 10))),
      minScore: Math.max(0, Math.min(100, Math.round(Number(minScore || 60)))),
      pauseEnabled: Boolean(pauseEnabled),
      pauseThreshold: Math.max(0, Math.min(100, Math.round(Number(pauseThreshold || 40)))),
      autoHide: {
        enabled: Boolean(autoHideEnabled),
        days: Math.max(1, Math.round(Number(autoHideDays || 30))),
        neverSoldEnabled: Boolean(autoHideNeverSoldEnabled),
        lastRunAt: String(autoHideLastRunAt || "").trim() || null,
        lastScanned: Math.max(0, Math.round(Number(autoHideLastScanned || 0))),
        lastHidden: Math.max(0, Math.round(Number(autoHideLastHidden || 0))),
      },
      summary: {
        businessesCount: rows.length,
        avgScore,
        belowMinScoreCount,
        belowPauseThresholdCount,
      },
      listTop,
      listAtRisk,
    });
  } catch (error: unknown) {
    const err = error as ApiError;
    return fail(
      err.code || "SERVER_ERROR",
      err.message || "Could not load menu quality overview.",
      err.status || 500
    );
  }
}
