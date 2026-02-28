import mongoose from "mongoose";
import { dbConnect } from "@/lib/mongodb";
import { ok, fail } from "@/lib/apiResponse";
import { requireAdminKey } from "@/lib/adminAuth";
import { Review } from "@/models/Review";
import { Business } from "@/models/Business";
import { Complaint } from "@/models/Complaint";
import { Order } from "@/models/Order";

type ApiError = Error & { status?: number; code?: string };

type SummaryAgg = {
  _id: null;
  totalReviews: number;
  avgRating: number;
  rating1: number;
  rating2: number;
  rating3: number;
  rating4: number;
  rating5: number;
};

type TagsAgg = {
  _id: string;
  count: number;
};

type WorstAgg = {
  _id: mongoose.Types.ObjectId;
  avgRating: number;
  reviewsCount: number;
};

type ComplaintsAgg = {
  _id: mongoose.Types.ObjectId;
  complaintsCount30d: number;
};

type AcceptanceAgg = {
  _id: mongoose.Types.ObjectId;
  acceptedCount: number;
  acceptedWithin7mCount: number;
};

function parseDays(raw: string | null) {
  const parsed = Number(raw || 30);
  if (!Number.isFinite(parsed)) return 30;
  return Math.max(1, Math.min(90, Math.floor(parsed)));
}

function parseLimit(raw: string | null) {
  const parsed = Number(raw || 100);
  if (!Number.isFinite(parsed)) return 100;
  return Math.max(1, Math.min(300, Math.floor(parsed)));
}

function toNumber(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export async function GET(req: Request) {
  try {
    requireAdminKey(req);
    const url = new URL(req.url);
    const days = parseDays(url.searchParams.get("days"));
    const limit = parseLimit(url.searchParams.get("limit"));
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    await dbConnect();

    const [summaryAgg, tagsAgg, worstAggRaw, latestRaw] = await Promise.all([
      Review.aggregate<SummaryAgg>([
        {
          $match: {
            createdAt: { $gte: since },
            isHidden: false,
          },
        },
        {
          $group: {
            _id: null,
            totalReviews: { $sum: 1 },
            avgRating: { $avg: "$rating" },
            rating1: { $sum: { $cond: [{ $eq: ["$rating", 1] }, 1, 0] } },
            rating2: { $sum: { $cond: [{ $eq: ["$rating", 2] }, 1, 0] } },
            rating3: { $sum: { $cond: [{ $eq: ["$rating", 3] }, 1, 0] } },
            rating4: { $sum: { $cond: [{ $eq: ["$rating", 4] }, 1, 0] } },
            rating5: { $sum: { $cond: [{ $eq: ["$rating", 5] }, 1, 0] } },
          },
        },
      ]),
      Review.aggregate<TagsAgg>([
        {
          $match: {
            createdAt: { $gte: since },
            isHidden: false,
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
        { $limit: 12 },
      ]),
      Review.aggregate<WorstAgg>([
        {
          $match: {
            createdAt: { $gte: since },
            isHidden: false,
          },
        },
        {
          $group: {
            _id: "$businessId",
            avgRating: { $avg: "$rating" },
            reviewsCount: { $sum: 1 },
          },
        },
        { $match: { reviewsCount: { $gte: 3 } } },
        { $sort: { avgRating: 1, reviewsCount: -1 } },
        { $limit: 50 },
      ]),
      Review.find({
        createdAt: { $gte: since },
      })
        .sort({ createdAt: -1 })
        .limit(limit)
        .select("_id businessId rating tags comment source createdAt isHidden")
        .lean(),
    ]);

    const worstBusinessIds = worstAggRaw.map((row) => row._id);
    const latestBusinessIds = latestRaw
      .map((row) => row.businessId)
      .filter((id) => id instanceof mongoose.Types.ObjectId);
    const businessIds = Array.from(
      new Set([...worstBusinessIds, ...latestBusinessIds].map((id) => String(id)))
    )
      .filter((id) => mongoose.Types.ObjectId.isValid(id))
      .map((id) => new mongoose.Types.ObjectId(id));

    const [businessRows, complaintsAgg, acceptanceAgg] = await Promise.all([
      businessIds.length
        ? Business.find({ _id: { $in: businessIds } }).select("name").lean()
        : [],
      worstBusinessIds.length
        ? Complaint.aggregate<ComplaintsAgg>([
            {
              $match: {
                createdAt: { $gte: since },
                businessId: { $in: worstBusinessIds },
              },
            },
            {
              $group: {
                _id: "$businessId",
                complaintsCount30d: { $sum: 1 },
              },
            },
          ])
        : [],
      worstBusinessIds.length
        ? Order.aggregate<AcceptanceAgg>([
            {
              $match: {
                status: "delivered",
                createdAt: { $gte: since },
                businessId: { $in: worstBusinessIds },
              },
            },
            {
              $project: {
                businessId: 1,
                acceptanceMinutes: {
                  $cond: [
                    {
                      $and: [
                        { $eq: [{ $type: "$statusTimestamps.acceptedAt" }, "date"] },
                        { $eq: [{ $type: "$createdAt" }, "date"] },
                      ],
                    },
                    {
                      $max: [
                        0,
                        {
                          $divide: [
                            { $subtract: ["$statusTimestamps.acceptedAt", "$createdAt"] },
                            60000,
                          ],
                        },
                      ],
                    },
                    null,
                  ],
                },
              },
            },
            {
              $group: {
                _id: "$businessId",
                acceptedCount: {
                  $sum: { $cond: [{ $ne: ["$acceptanceMinutes", null] }, 1, 0] },
                },
                acceptedWithin7mCount: {
                  $sum: {
                    $cond: [
                      {
                        $and: [
                          { $ne: ["$acceptanceMinutes", null] },
                          { $lte: ["$acceptanceMinutes", 7] },
                        ],
                      },
                      1,
                      0,
                    ],
                  },
                },
              },
            },
          ])
        : [],
    ]);

    const businessMap = new Map(businessRows.map((row) => [String(row._id), String(row.name || "Business")]));
    const complaintsMap = new Map(
      complaintsAgg.map((row) => [String(row._id), Number(row.complaintsCount30d || 0)])
    );
    const acceptanceMap = new Map(
      acceptanceAgg.map((row) => {
        const acceptedCount = Number(row.acceptedCount || 0);
        const acceptedWithin7mCount = Number(row.acceptedWithin7mCount || 0);
        return [
          String(row._id),
          acceptedCount > 0 ? Number((acceptedWithin7mCount / acceptedCount).toFixed(2)) : 0,
        ] as const;
      })
    );

    const summary = summaryAgg[0];
    const worstBusinesses = worstAggRaw.map((row) => ({
      businessId: String(row._id),
      businessName: businessMap.get(String(row._id)) || "Business",
      avgRating: Number(toNumber(row.avgRating).toFixed(2)),
      reviewsCount: Number(row.reviewsCount || 0),
      complaints30d: Number(complaintsMap.get(String(row._id)) || 0),
      acceptanceRate30d: Number(acceptanceMap.get(String(row._id)) || 0),
    }));

    const latest = latestRaw.map((row) => ({
      reviewId: String(row._id),
      businessId: String(row.businessId || ""),
      businessName: businessMap.get(String(row.businessId || "")) || "Business",
      rating: Number(row.rating || 0),
      tags: Array.isArray(row.tags) ? row.tags : [],
      comment: String(row.comment || ""),
      source: String(row.source || "unknown"),
      createdAt: row.createdAt,
      isHidden: Boolean(row.isHidden),
    }));

    return ok({
      summary: {
        totalReviews: Number(summary?.totalReviews || 0),
        avgRating: Number(toNumber(summary?.avgRating).toFixed(2)),
        ratingCounts: {
          1: Number(summary?.rating1 || 0),
          2: Number(summary?.rating2 || 0),
          3: Number(summary?.rating3 || 0),
          4: Number(summary?.rating4 || 0),
          5: Number(summary?.rating5 || 0),
        },
        tagsTop: tagsAgg.map((row) => ({
          tag: String(row._id || ""),
          count: Number(row.count || 0),
        })),
      },
      worstBusinesses: worstBusinesses.slice(0, 25),
      latest,
    });
  } catch (error: unknown) {
    const err = error as ApiError;
    return fail(
      err.code || "SERVER_ERROR",
      err.message || "Could not load reviews ops summary.",
      err.status || 500
    );
  }
}

