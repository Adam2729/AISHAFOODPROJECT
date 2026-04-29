import { dbConnect } from "@/lib/mongodb";
import { Business } from "@/models/Business";
import {
  computeScore,
  computeTier,
  computeTierWithProbation,
  isProbation,
  type Tier,
} from "@/lib/performanceScore";

type BusinessRow = {
  _id: unknown;
  paused?: boolean;
  health?: {
    complaintsCount?: number;
    cancelsCount30d?: number;
    slowAcceptCount30d?: number;
  };
  performance?: {
    score?: number;
    tier?: Tier;
    updatedAt?: Date | null;
    overrideBoost?: number;
    overrideTier?: Tier | null;
  };
};

function toNumber(value: unknown) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function normalizeOverrideTier(value: unknown): Tier | null {
  const tier = String(value || "").trim().toLowerCase();
  if (tier === "gold" || tier === "silver" || tier === "bronze" || tier === "probation") {
    return tier;
  }
  return null;
}

export async function runPerformanceRecompute(): Promise<{
  processed: number;
  updated: number;
  probationCount: number;
  gold: number;
  silver: number;
  bronze: number;
  ranAt: string;
}> {
  await dbConnect();
  const now = new Date();

  const businesses = await Business.find({
    isActive: true,
    isDemo: { $ne: true },
  })
    .select("paused health performance")
    .lean<BusinessRow[]>();

  const operations: Array<{
    updateOne: {
      filter: Record<string, unknown>;
      update: Record<string, unknown>;
    };
  }> = [];

  let probationCount = 0;
  let gold = 0;
  let silver = 0;
  let bronze = 0;

  for (const business of businesses) {
    const slowAccept30d = toNumber(business.health?.slowAcceptCount30d);
    const cancels30d = toNumber(business.health?.cancelsCount30d);
    const complaints30d = toNumber(business.health?.complaintsCount);
    const paused = Boolean(business.paused);
    const overrideBoost = clamp(toNumber(business.performance?.overrideBoost), -50, 50);
    const overrideTier = normalizeOverrideTier(business.performance?.overrideTier);

    const score = computeScore({
      slowAccept30d,
      cancels30d,
      complaints30d,
      paused,
      overrideBoost,
    });

    const probation = isProbation({ slowAccept30d, cancels30d, complaints30d }) || overrideTier === "probation";
    let tier = computeTierWithProbation({ score, probation });
    if (!probation && overrideTier) {
      tier = overrideTier;
    } else if (!probation && !overrideTier) {
      tier = computeTier(score);
    }

    if (tier === "probation") probationCount += 1;
    if (tier === "gold") gold += 1;
    if (tier === "silver") silver += 1;
    if (tier === "bronze") bronze += 1;

    const currentScore = toNumber(business.performance?.score);
    const currentTier = normalizeOverrideTier(business.performance?.tier);
    const hasUpdatedAt = Boolean(business.performance?.updatedAt);
    const needsUpdate = !hasUpdatedAt || currentScore !== score || currentTier !== tier;
    if (!needsUpdate) continue;

    operations.push({
      updateOne: {
        filter: { _id: business._id },
        update: {
          $set: {
            "performance.score": score,
            "performance.tier": tier,
            "performance.updatedAt": now,
            "performance.overrideBoost": overrideBoost,
          },
        },
      },
    });
  }

  let updated = 0;
  if (operations.length) {
    const result = await Business.bulkWrite(operations, { ordered: false });
    updated = Number(result.modifiedCount || 0);
  }

  return {
    processed: businesses.length,
    updated,
    probationCount,
    gold,
    silver,
    bronze,
    ranAt: now.toISOString(),
  };
}
