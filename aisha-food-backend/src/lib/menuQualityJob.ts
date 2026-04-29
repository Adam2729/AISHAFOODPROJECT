import mongoose from "mongoose";
import { dbConnect } from "@/lib/mongodb";
import { getBoolSetting, getNumberSetting } from "@/lib/appSettings";
import { computeMenuQualityForBusinesses, type MenuQuality } from "@/lib/menuQuality";
import { Business } from "@/models/Business";
import { BusinessAudit } from "@/models/BusinessAudit";
import { OpsEvent } from "@/models/OpsEvent";
import { getWeekKey } from "@/lib/geo";

type RunOpts = {
  onlyBusinessIds?: mongoose.Types.ObjectId[];
};

type BusinessRow = {
  _id: mongoose.Types.ObjectId;
  name?: string;
  isDemo?: boolean;
  paused?: boolean;
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

function qualityChanged(current: BusinessRow["menuQuality"] | undefined, next: MenuQuality) {
  if (!current) return true;
  return (
    toNumber(current.productsTotalCount) !== next.productsTotalCount ||
    toNumber(current.productsActiveCount) !== next.productsActiveCount ||
    toNumber(current.productsWithImageCount) !== next.productsWithImageCount ||
    toNumber(current.categoriesCount) !== next.categoriesCount ||
    Boolean(current.hasMinProducts) !== next.hasMinProducts ||
    toNumber(current.score) !== next.menuQualityScore
  );
}

function normalizeOnlyBusinessIds(onlyBusinessIds: mongoose.Types.ObjectId[] | undefined) {
  if (!Array.isArray(onlyBusinessIds) || !onlyBusinessIds.length) return [];
  const seen = new Set<string>();
  const ids: mongoose.Types.ObjectId[] = [];
  for (const raw of onlyBusinessIds) {
    const id = String(raw || "").trim();
    if (!mongoose.Types.ObjectId.isValid(id) || seen.has(id)) continue;
    seen.add(id);
    ids.push(new mongoose.Types.ObjectId(id));
  }
  return ids;
}

export async function runMenuQualityRecomputeJob(opts?: RunOpts) {
  await dbConnect();
  const [pauseEnabled, pauseThreshold] = await Promise.all([
    getBoolSetting("menu_quality_pause_enabled", false),
    getNumberSetting("menu_quality_pause_threshold", 40),
  ]);
  const safePauseThreshold = Math.max(0, Math.min(100, Math.round(pauseThreshold || 40)));

  const onlyIds = normalizeOnlyBusinessIds(opts?.onlyBusinessIds);
  const query: Record<string, unknown> = {
    isActive: true,
    isDemo: { $ne: true },
  };
  if (onlyIds.length) {
    query._id = { $in: onlyIds };
  }

  const businesses = await Business.find(query)
    .select("name isDemo paused menuQuality")
    .lean<BusinessRow[]>();
  if (!businesses.length) {
    return {
      scanned: 0,
      updated: 0,
      autoPaused: 0,
    };
  }

  const qualityMap = await computeMenuQualityForBusinesses(businesses.map((row) => row._id));
  const now = new Date();
  const businessWrites: Array<{
    updateOne: {
      filter: Record<string, unknown>;
      update: Record<string, unknown>;
    };
  }> = [];

  const toAutoPause: Array<{ _id: mongoose.Types.ObjectId; name: string; score: number }> = [];
  for (const business of businesses) {
    const key = String(business._id);
    const quality = qualityMap.get(key);
    if (!quality) continue;
    const changed = qualityChanged(business.menuQuality, quality) || !business.menuQuality?.updatedAt;
    if (changed) {
      businessWrites.push({
        updateOne: {
          filter: { _id: business._id },
          update: {
            $set: {
              "menuQuality.productsTotalCount": quality.productsTotalCount,
              "menuQuality.productsActiveCount": quality.productsActiveCount,
              "menuQuality.productsWithImageCount": quality.productsWithImageCount,
              "menuQuality.categoriesCount": quality.categoriesCount,
              "menuQuality.hasMinProducts": quality.hasMinProducts,
              "menuQuality.score": quality.menuQualityScore,
              "menuQuality.updatedAt": now,
            },
          },
        },
      });
    }

    if (
      pauseEnabled &&
      !business.isDemo &&
      !business.paused &&
      quality.menuQualityScore < safePauseThreshold
    ) {
      toAutoPause.push({
        _id: business._id,
        name: String(business.name || "Business"),
        score: quality.menuQualityScore,
      });
      businessWrites.push({
        updateOne: {
          filter: { _id: business._id, paused: { $ne: true } },
          update: {
            $set: {
              paused: true,
              pausedReason: "menu_quality_low",
              pausedAt: now,
            },
          },
        },
      });
    }
  }

  let modifiedFromBulk = 0;
  if (businessWrites.length) {
    const writeResult = await Business.bulkWrite(businessWrites, { ordered: false });
    modifiedFromBulk =
      toNumber((writeResult as unknown as { modifiedCount?: number })?.modifiedCount) +
      toNumber((writeResult as unknown as { upsertedCount?: number })?.upsertedCount);
  }

  const weekKey = getWeekKey(now);
  const pauseMeta = toAutoPause.map((row) => ({
    businessId: row._id,
    action: "AUTO_PAUSE_MENU_QUALITY" as const,
    meta: {
      reason: "menu_quality_low",
      score: row.score,
      threshold: safePauseThreshold,
    },
  }));
  const pauseOpsEvents = toAutoPause.map((row) => ({
    type: "BUSINESS_AUTO_PAUSED" as const,
    reason: "menu_quality_low" as const,
    weekKey,
    businessId: row._id,
    businessName: row.name,
  }));

  if (pauseMeta.length) {
    await Promise.all([
      BusinessAudit.insertMany(pauseMeta, { ordered: false }).catch(() => []),
      OpsEvent.insertMany(pauseOpsEvents, { ordered: false }).catch(() => []),
    ]);
  }

  return {
    scanned: businesses.length,
    updated: modifiedFromBulk,
    autoPaused: toAutoPause.length,
  };
}
