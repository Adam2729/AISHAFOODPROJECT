import mongoose from "mongoose";
import { dbConnect } from "@/lib/mongodb";
import { ok, fail } from "@/lib/apiResponse";
import { requireAdminKey } from "@/lib/adminAuth";
import { getNumberSetting } from "@/lib/appSettings";
import { SearchEvent } from "@/models/SearchEvent";
import { Business } from "@/models/Business";

type ApiError = Error & { status?: number; code?: string };

type TopQueryAgg = {
  _id: string;
  count: number;
};

type SourceAgg = {
  _id: string;
  count: number;
  zeroResults: number;
};

type OpportunityAgg = {
  _id: mongoose.Types.ObjectId;
  impressions: number;
};

function toUtcDayRange(dayParam: string | null) {
  if (!dayParam) {
    const now = new Date();
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
    return { start, end };
  }

  const trimmed = String(dayParam).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    const err = new Error("Invalid day format. Use YYYY-MM-DD.") as ApiError;
    err.status = 400;
    err.code = "VALIDATION_ERROR";
    throw err;
  }
  const start = new Date(`${trimmed}T00:00:00.000Z`);
  if (Number.isNaN(start.getTime())) {
    const err = new Error("Invalid day.") as ApiError;
    err.status = 400;
    err.code = "VALIDATION_ERROR";
    throw err;
  }
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { start, end };
}

export async function GET(req: Request) {
  try {
    requireAdminKey(req);
    await dbConnect();

    const url = new URL(req.url);
    const { start, end } = toUtcDayRange(url.searchParams.get("day"));
    const minMenuQualityScore = Math.max(
      0,
      Math.min(100, Math.round(Number(await getNumberSetting("menu_quality_min_score", 60))))
    );

    const [searches, zeroResults, topQueriesRaw, bySourceRaw, opportunitiesRaw] = await Promise.all([
      SearchEvent.countDocuments({
        createdAt: { $gte: start, $lt: end },
      }),
      SearchEvent.countDocuments({
        createdAt: { $gte: start, $lt: end },
        zeroResults: true,
      }),
      SearchEvent.aggregate<TopQueryAgg>([
        {
          $match: {
            createdAt: { $gte: start, $lt: end },
          },
        },
        {
          $group: {
            _id: "$queryHash",
            count: { $sum: 1 },
          },
        },
        { $sort: { count: -1, _id: 1 } },
        { $limit: 20 },
      ]),
      SearchEvent.aggregate<SourceAgg>([
        {
          $match: {
            createdAt: { $gte: start, $lt: end },
          },
        },
        {
          $group: {
            _id: "$source",
            count: { $sum: 1 },
            zeroResults: {
              $sum: {
                $cond: [{ $eq: ["$zeroResults", true] }, 1, 0],
              },
            },
          },
        },
        { $sort: { count: -1, _id: 1 } },
      ]),
      SearchEvent.aggregate<OpportunityAgg>([
        {
          $match: {
            createdAt: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
            resultsProducts: { $gt: 0 },
            topBusinessIds: { $exists: true, $ne: [] },
          },
        },
        { $unwind: "$topBusinessIds" },
        {
          $group: {
            _id: "$topBusinessIds",
            impressions: { $sum: 1 },
          },
        },
        { $sort: { impressions: -1 } },
        { $limit: 100 },
      ]),
    ]);

    const topQueries = topQueriesRaw.map((row) => ({
      queryHash: String(row._id || ""),
      count: Number(row.count || 0),
    }));
    const bySource = bySourceRaw.map((row) => {
      const count = Number(row.count || 0);
      const noResultCount = Number(row.zeroResults || 0);
      return {
        source: String(row._id || "unknown"),
        count,
        noResultRate: count > 0 ? Number((noResultCount / count).toFixed(4)) : 0,
      };
    });

    const topSource = bySource.length
      ? bySource.reduce((max, row) => (row.count > max.count ? row : max), bySource[0])
      : { source: "unknown", count: 0, noResultRate: 0 };

    const opportunitiesBusinessIds = opportunitiesRaw.map((row) => row._id);
    const opportunityBusinesses = opportunitiesBusinessIds.length
      ? await Business.find({ _id: { $in: opportunitiesBusinessIds } })
          .select("name menuQuality.score paused pausedReason")
          .lean()
      : [];
    const businessMap = new Map(opportunityBusinesses.map((row) => [String(row._id), row]));

    const opportunities = opportunitiesRaw
      .map((row) => {
        const business = businessMap.get(String(row._id));
        if (!business) return null;
        const menuQualityScore = Number(business.menuQuality?.score || 0);
        if (menuQualityScore >= minMenuQualityScore) return null;
        return {
          businessId: String(row._id),
          businessName: String(business.name || "Business"),
          impressions: Number(row.impressions || 0),
          menuQualityScore: Math.round(menuQualityScore),
          paused: Boolean(business.paused),
          pausedReason: String(business.pausedReason || ""),
        };
      })
      .filter(Boolean)
      .slice(0, 20);

    const noResultRate = searches > 0 ? Number((zeroResults / searches).toFixed(4)) : 0;

    return ok({
      window: {
        start: start.toISOString(),
        end: end.toISOString(),
      },
      counts: {
        searches,
        zeroResults,
        noResultRate,
      },
      topSource,
      topQueries,
      bySource,
      opportunities,
    });
  } catch (error: unknown) {
    const err = error as ApiError;
    return fail(
      err.code || "SERVER_ERROR",
      err.message || "Could not load search telemetry.",
      err.status || 500
    );
  }
}
