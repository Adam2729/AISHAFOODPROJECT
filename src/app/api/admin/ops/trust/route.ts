import mongoose from "mongoose";
import { dbConnect } from "@/lib/mongodb";
import { ok, fail } from "@/lib/apiResponse";
import { requireAdminKey } from "@/lib/adminAuth";
import { isBusinessOpenNow } from "@/lib/businessHours";
import { formatEtaText } from "@/lib/eta";
import { computeTrustBadge } from "@/lib/trustBadge";
import { Business } from "@/models/Business";
import { Order } from "@/models/Order";
import { Complaint } from "@/models/Complaint";

type ApiError = Error & { status?: number; code?: string };

type OrderTrustAgg = {
  _id: mongoose.Types.ObjectId;
  deliveredCount30d: number;
  acceptedCount30d: number;
  acceptedWithin7mCount30d: number;
};

type ComplaintTrustAgg = {
  _id: mongoose.Types.ObjectId;
  complaintsCount30d: number;
};

type StaleAgg = {
  _id: mongoose.Types.ObjectId;
  staleNewOrdersCount24h: number;
};

export async function GET(req: Request) {
  try {
    requireAdminKey(req);
    await dbConnect();

    const businesses = await Business.find({
      isActive: true,
      isDemo: { $ne: true },
    })
      .select("name paused isManuallyPaused busyUntil hours performance eta")
      .lean();

    if (!businesses.length) {
      return ok({
        badgeCounts: { top: 0, good: 0, new: 0, at_risk: 0 },
        atRiskList: [],
      });
    }

    const businessIds = businesses.map((row) => row._id as mongoose.Types.ObjectId);
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const sevenMinutesAgo = new Date(Date.now() - 7 * 60 * 1000);

    const [orderTrustAgg, complaintTrustAgg, staleAgg] = await Promise.all([
      Order.aggregate<OrderTrustAgg>([
        {
          $match: {
            status: "delivered",
            createdAt: { $gte: thirtyDaysAgo },
            businessId: { $in: businessIds },
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
            deliveredCount30d: { $sum: 1 },
            acceptedCount30d: {
              $sum: { $cond: [{ $ne: ["$acceptanceMinutes", null] }, 1, 0] },
            },
            acceptedWithin7mCount30d: {
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
      ]),
      Complaint.aggregate<ComplaintTrustAgg>([
        {
          $match: {
            createdAt: { $gte: thirtyDaysAgo },
            businessId: { $in: businessIds },
          },
        },
        {
          $group: {
            _id: "$businessId",
            complaintsCount30d: { $sum: 1 },
          },
        },
      ]),
      Order.aggregate<StaleAgg>([
        {
          $match: {
            status: "new",
            createdAt: { $gte: dayAgo, $lte: sevenMinutesAgo },
            businessId: { $in: businessIds },
          },
        },
        {
          $group: {
            _id: "$businessId",
            staleNewOrdersCount24h: { $sum: 1 },
          },
        },
      ]),
    ]);

    const orderTrustMap = new Map(orderTrustAgg.map((row) => [String(row._id), row]));
    const complaintTrustMap = new Map(complaintTrustAgg.map((row) => [String(row._id), row]));
    const staleMap = new Map(staleAgg.map((row) => [String(row._id), row]));

    const badgeCounts = {
      top: 0,
      good: 0,
      new: 0,
      at_risk: 0,
    };

    const atRiskList = businesses
      .map((business) => {
        const id = String(business._id);
        const orderStats = orderTrustMap.get(id);
        const complaintStats = complaintTrustMap.get(id);
        const staleStats = staleMap.get(id);
        const delivered30d = Number(orderStats?.deliveredCount30d || 0);
        const acceptedCount30d = Number(orderStats?.acceptedCount30d || 0);
        const acceptedWithin7mCount30d = Number(orderStats?.acceptedWithin7mCount30d || 0);
        const acceptanceWithin7mRate30d =
          acceptedCount30d > 0 ? acceptedWithin7mCount30d / acceptedCount30d : 0;
        const complaints30d = Number(complaintStats?.complaintsCount30d || 0);
        const staleNewOrdersCount24h = Number(staleStats?.staleNewOrdersCount24h || 0);
        const trust = computeTrustBadge({
          delivered30d,
          complaints30d,
          acceptanceWithin7mRate30d,
          staleNewOrdersCount24h,
          isPaused: Boolean((business as { paused?: boolean }).paused),
          isManuallyPaused: Boolean(
            (business as { isManuallyPaused?: boolean }).isManuallyPaused
          ),
          businessTier: String(
            (business as { performance?: { tier?: string } }).performance?.tier || "bronze"
          ),
        });
        badgeCounts[trust.badge] += 1;

        const openStatus = isBusinessOpenNow(business);
        const eta = (business as { eta?: { minMins?: number; maxMins?: number } }).eta || {};
        const etaText = formatEtaText(eta.minMins, eta.maxMins);

        return {
          businessId: id,
          businessName: String((business as { name?: string }).name || "Business"),
          trust: {
            badge: trust.badge,
            delivered30d,
            acceptanceWithin7mRate30d: Number(acceptanceWithin7mRate30d.toFixed(2)),
            complaints30d,
            staleNewOrdersCount24h,
          },
          etaText,
          isManuallyPaused: Boolean(
            (business as { isManuallyPaused?: boolean }).isManuallyPaused
          ),
          busyUntil:
            (business as { busyUntil?: Date | null }).busyUntil &&
            !Number.isNaN(
              new Date((business as { busyUntil?: Date | null }).busyUntil as Date).getTime()
            )
              ? new Date(
                  (business as { busyUntil?: Date | null }).busyUntil as Date
                ).toISOString()
              : null,
          isOpenNow: Boolean(openStatus.open),
        };
      })
      .filter((row) => row.trust.badge === "at_risk")
      .sort((a, b) => {
        const complaintsDiff = b.trust.complaints30d - a.trust.complaints30d;
        if (complaintsDiff !== 0) return complaintsDiff;
        const rateDiff =
          a.trust.acceptanceWithin7mRate30d - b.trust.acceptanceWithin7mRate30d;
        if (rateDiff !== 0) return rateDiff;
        return a.businessName.localeCompare(b.businessName, "es");
      })
      .slice(0, 25);

    return ok({ badgeCounts, atRiskList });
  } catch (error: unknown) {
    const err = error as ApiError;
    return fail(
      err.code || "SERVER_ERROR",
      err.message || "Could not load trust overview.",
      err.status || 500
    );
  }
}

