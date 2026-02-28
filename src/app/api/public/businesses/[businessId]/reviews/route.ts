import mongoose from "mongoose";
import { dbConnect } from "@/lib/mongodb";
import { ok, fail } from "@/lib/apiResponse";
import { assertNotInMaintenance } from "@/lib/maintenance";
import { BASE_LOCATION, MAX_RADIUS_KM } from "@/lib/constants";
import { isWithinRadiusKm } from "@/lib/geo";
import { computeSubscriptionStatus } from "@/lib/subscription";
import { Business } from "@/models/Business";
import { Review } from "@/models/Review";

type ReviewSummaryAgg = {
  _id: null;
  avgRating30d: number;
  count30d: number;
  rating1: number;
  rating2: number;
  rating3: number;
  rating4: number;
  rating5: number;
};

type TopTagAgg = {
  _id: string;
  count: number;
};

function parseLimit(raw: string | null) {
  const parsed = Number(raw || 20);
  if (!Number.isFinite(parsed)) return 20;
  return Math.max(1, Math.min(50, Math.floor(parsed)));
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ businessId: string }> }
) {
  try {
    await assertNotInMaintenance();
    const { businessId } = await params;
    if (!mongoose.Types.ObjectId.isValid(businessId)) {
      return fail("VALIDATION_ERROR", "Invalid businessId.", 400);
    }

    const url = new URL(req.url);
    const limit = parseLimit(url.searchParams.get("limit"));
    const businessObjectId = new mongoose.Types.ObjectId(businessId);
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    await dbConnect();
    const business = await Business.findById(businessObjectId)
      .select("isActive subscription location")
      .lean();
    if (!business || !business.isActive) {
      return fail("NOT_FOUND", "Business not found.", 404);
    }
    const subscription = computeSubscriptionStatus(
      (business as { subscription?: Record<string, unknown> }).subscription || {}
    );
    if (subscription.status === "suspended") {
      return fail("BUSINESS_SUSPENDED", "Business is not available right now.", 403);
    }
    const bLng = Number(
      (business as { location?: { coordinates?: [number, number] } }).location?.coordinates?.[0]
    );
    const bLat = Number(
      (business as { location?: { coordinates?: [number, number] } }).location?.coordinates?.[1]
    );
    if (
      !Number.isFinite(bLat) ||
      !Number.isFinite(bLng) ||
      !isWithinRadiusKm(BASE_LOCATION.lat, BASE_LOCATION.lng, bLat, bLng, MAX_RADIUS_KM)
    ) {
      return fail("BUSINESS_OUTSIDE_CLUSTER", "Business is outside coverage cluster.", 400);
    }

    const [summaryAgg, tagsAgg, reviews] = await Promise.all([
      Review.aggregate<ReviewSummaryAgg>([
        {
          $match: {
            businessId: businessObjectId,
            isHidden: false,
            createdAt: { $gte: since },
          },
        },
        {
          $group: {
            _id: null,
            avgRating30d: { $avg: "$rating" },
            count30d: { $sum: 1 },
            rating1: { $sum: { $cond: [{ $eq: ["$rating", 1] }, 1, 0] } },
            rating2: { $sum: { $cond: [{ $eq: ["$rating", 2] }, 1, 0] } },
            rating3: { $sum: { $cond: [{ $eq: ["$rating", 3] }, 1, 0] } },
            rating4: { $sum: { $cond: [{ $eq: ["$rating", 4] }, 1, 0] } },
            rating5: { $sum: { $cond: [{ $eq: ["$rating", 5] }, 1, 0] } },
          },
        },
      ]),
      Review.aggregate<TopTagAgg>([
        {
          $match: {
            businessId: businessObjectId,
            isHidden: false,
            createdAt: { $gte: since },
            tags: { $exists: true, $ne: [] },
          },
        },
        { $unwind: "$tags" },
        {
          $group: {
            _id: "$tags",
            count: { $sum: 1 },
          },
        },
        { $sort: { count: -1, _id: 1 } },
        { $limit: 10 },
      ]),
      Review.find({
        businessId: businessObjectId,
        isHidden: false,
      })
        .select("rating tags comment createdAt source")
        .sort({ createdAt: -1 })
        .limit(limit)
        .lean(),
    ]);

    const summary = summaryAgg[0];
    const ratingCounts30d = {
      1: Number(summary?.rating1 || 0),
      2: Number(summary?.rating2 || 0),
      3: Number(summary?.rating3 || 0),
      4: Number(summary?.rating4 || 0),
      5: Number(summary?.rating5 || 0),
    };

    return ok({
      summary: {
        avgRating30d: Number(Number(summary?.avgRating30d || 0).toFixed(2)),
        count30d: Number(summary?.count30d || 0),
        ratingCounts30d,
        tagsTop30d: tagsAgg.map((row) => ({
          tag: String(row._id || ""),
          count: Number(row.count || 0),
        })),
      },
      reviews: reviews.map((row) => ({
        rating: Number(row.rating || 0),
        tags: Array.isArray(row.tags) ? row.tags : [],
        comment: String(row.comment || ""),
        createdAt: row.createdAt,
        source: String(row.source || "unknown"),
      })),
    });
  } catch (error: unknown) {
    const err = error as Error & { status?: number; code?: string };
    return fail(err.code || "SERVER_ERROR", err.message || "Could not load reviews.", err.status || 500);
  }
}
