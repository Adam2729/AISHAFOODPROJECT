import mongoose from "mongoose";
import { dbConnect } from "@/lib/mongodb";
import { ok, fail } from "@/lib/apiResponse";
import { requireAdminKey } from "@/lib/adminAuth";
import { getWeekKey } from "@/lib/geo";
import { computeSubscriptionStatus } from "@/lib/subscription";
import { runSubscriptionStatusJob } from "@/lib/subscriptionJob";
import { getPromoPolicyForWeek } from "@/lib/promoBudget";
import { getNumberSetting } from "@/lib/appSettings";
import { computeMenuQualityForBusinesses } from "@/lib/menuQuality";
import { ENV_PII_PHONE_RETENTION_DAYS } from "@/lib/env";
import { Business } from "@/models/Business";
import { Order } from "@/models/Order";
import { OpsEvent } from "@/models/OpsEvent";

type ApiError = Error & { status?: number; code?: string };

type TopBusinessAgg = {
  _id: mongoose.Types.ObjectId;
  orders: number;
  subtotal: number;
};

type SubscriptionInput = {
  trialEndsAt?: Date | string | null;
  paidUntilAt?: Date | string | null;
  graceDays?: number | null;
};

type NumberAgg = { _id: null; value: number };
type RepeatAgg = { _id: string; orders: number };
type SourceKey = "organic" | "whatsapp" | "flyer" | "merchant_referral";
type SourceAggDay = { _id: string; ordersToday: number; deliveredToday: number };
type SourceAggWeek = {
  _id: string;
  deliveredCount: number;
  commissionTotal: number;
  promoDiscountTotal: number;
  netSubtotalTotal: number;
};
type CampaignAggWeek = {
  _id: string;
  deliveredCount: number;
  commissionTotal: number;
  promoDiscountTotal: number;
};
type TierAgg = { _id: string; count: number };
type SlaAvgAgg = {
  _id: null;
  avgFirstActionMinutes: number;
  avgTotalMinutes: number;
};
type SlowestBusinessAgg = {
  _id: mongoose.Types.ObjectId;
  businessName: string;
  avgTotalMinutes: number;
  deliveredCount: number;
};
type AcceptanceWeekAgg = {
  _id: null;
  acceptedCount: number;
  acceptedWithin7mCount: number;
  avgAcceptanceMinutes: number;
};
type SlowestAcceptanceBusinessAgg = {
  _id: mongoose.Types.ObjectId;
  businessName: string;
  avgAcceptanceMinutes: number;
  acceptedCount: number;
};
type RepeatLast7dAgg = {
  _id: string;
  orders: number;
};
type RepeatBySourceAgg = {
  _id: string;
  customers: number;
  repeatCustomers: number;
};
type TopRepeatBusinessAgg = {
  _id: {
    businessId: mongoose.Types.ObjectId;
    businessName: string;
  };
  customers: number;
  repeatCustomers: number;
};
type DeliveredProofAgg = {
  _id: string;
  count: number;
};
type TopOverrideBusinessAgg = {
  _id: mongoose.Types.ObjectId;
  businessName: string;
  overridesCount: number;
};
type BlockedReasonAgg = {
  _id: string;
  blockedCount: number;
};
type TopBlockedBusinessAgg = {
  _id: mongoose.Types.ObjectId;
  businessName: string;
  blockedCount: number;
};
type RateLimitBlockedRouteAgg = {
  _id: string;
  count: number;
};
type TopAbuseIpAgg = {
  _id: string;
  count: number;
};
type PiiRedactRunLean = {
  createdAt?: Date;
  meta?: {
    retentionDays?: number;
    ordersScanned?: number;
    ordersRedacted?: number;
    complaintsScanned?: number;
    complaintsRedacted?: number;
  } | null;
};

type MenuQualityBusinessRow = {
  _id: mongoose.Types.ObjectId;
  menuQuality?: {
    score?: number | null;
    updatedAt?: Date | null;
  } | null;
};

const SOURCE_KEYS: SourceKey[] = ["organic", "whatsapp", "flyer", "merchant_referral"];

function growthPct(current: number, previous: number) {
  if (previous <= 0) return current > 0 ? 100 : 0;
  return Number((((current - previous) / previous) * 100).toFixed(2));
}

function blankSourceMap() {
  return SOURCE_KEYS.reduce<Record<SourceKey, number>>(
    (acc, key) => {
      acc[key] = 0;
      return acc;
    },
    { organic: 0, whatsapp: 0, flyer: 0, merchant_referral: 0 }
  );
}

function normalizeSource(value: unknown): SourceKey {
  const raw = String(value || "").trim().toLowerCase() as SourceKey;
  return SOURCE_KEYS.includes(raw) ? raw : "organic";
}

async function sumValue(match: Record<string, unknown>, field: string) {
  const agg = await Order.aggregate<NumberAgg>([
    { $match: match },
    { $group: { _id: null, value: { $sum: `$${field}` } } },
  ]);
  return Number(agg[0]?.value || 0);
}

export async function GET(req: Request) {
  try {
    requireAdminKey(req);
    await dbConnect();
    await runSubscriptionStatusJob();

    const today = new Date();
    const dayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const weekKey = getWeekKey(today);
    const prevWeekDate = new Date(today);
    prevWeekDate.setDate(prevWeekDate.getDate() - 7);
    const prevWeekKey = getWeekKey(prevWeekDate);
    const last30Days = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const businesses = await Business.find({ isActive: true }).select("name subscription").lean();
    const businessesActive = businesses.filter(
      (b) =>
        computeSubscriptionStatus(
          ((b as { subscription?: SubscriptionInput }).subscription || {}) as SubscriptionInput
        ).status !== "suspended"
    ).length;

    const ordersToday = await Order.countDocuments({ createdAt: { $gte: dayStart } });
    const ordersThisWeek = await Order.countDocuments({ "settlement.weekKey": weekKey });
    const deliveredThisWeek = await Order.countDocuments({
      "settlement.weekKey": weekKey,
      status: "delivered",
    });
    const deliveredPrevWeek = await Order.countDocuments({
      "settlement.weekKey": prevWeekKey,
      status: "delivered",
    });

    const [feeThisWeek, feePrevWeek, commissionToday] = await Promise.all([
      sumValue({ "settlement.weekKey": weekKey, status: "delivered" }, "commissionAmount"),
      sumValue({ "settlement.weekKey": prevWeekKey, status: "delivered" }, "commissionAmount"),
      sumValue({ createdAt: { $gte: dayStart }, status: "delivered" }, "commissionAmount"),
    ]);

    const topRaw = await Order.aggregate<TopBusinessAgg>([
      { $match: { "settlement.weekKey": weekKey, status: "delivered" } },
      { $group: { _id: "$businessId", orders: { $sum: 1 }, subtotal: { $sum: "$subtotal" } } },
      { $sort: { orders: -1 } },
      { $limit: 5 },
    ]);
    const byBusinessId = new Map(topRaw.map((x) => [String(x._id), x]));
    const topBusinessesDocs = await Business.find({ _id: { $in: topRaw.map((x) => x._id) } })
      .select("name")
      .lean();
    const topBusinesses = topBusinessesDocs.map((b) => {
      const base = byBusinessId.get(String(b._id));
      return {
        businessId: String(b._id),
        name: b.name,
        orders: base?.orders || 0,
        subtotal: base?.subtotal || 0,
      };
    });

    const activeBusinessesAgg = await Order.aggregate<{ _id: mongoose.Types.ObjectId }>([
      { $match: { createdAt: { $gte: last30Days } } },
      { $group: { _id: "$businessId" } },
    ]);
    const activeBusinesses = activeBusinessesAgg.length;
    const churnedBusinesses = Math.max(0, businessesActive - activeBusinesses);

    const [
      todayUniqueAgg,
      weekUniqueAgg,
      weekRepeatAgg,
      promoOrdersCount,
      promoPolicy,
      todaySourceAgg,
      weekSourceAgg,
      topCampaignsWeekAgg,
      merchantTierAgg,
      slaAvgAgg,
      slowestBusinessesAgg,
      acceptanceWeekAgg,
      slowestAcceptanceWeekAgg,
      blockedReasonsWeekAgg,
      topBlockedBusinessesWeekAgg,
      repeatLast7dAgg,
      repeatBySourceLast7dAgg,
      topRepeatBusinessesLast7dAgg,
      deliveredProofWeekAgg,
      topOverrideBusinessesWeekAgg,
    ] = await Promise.all([
      Order.aggregate<NumberAgg>([
        { $match: { createdAt: { $gte: dayStart }, status: "delivered", phoneHash: { $exists: true, $ne: "" } } },
        { $group: { _id: "$phoneHash" } },
        { $group: { _id: null, value: { $sum: 1 } } },
      ]),
      Order.aggregate<NumberAgg>([
        { $match: { "settlement.weekKey": weekKey, status: "delivered", phoneHash: { $exists: true, $ne: "" } } },
        { $group: { _id: "$phoneHash" } },
        { $group: { _id: null, value: { $sum: 1 } } },
      ]),
      Order.aggregate<RepeatAgg>([
        { $match: { "settlement.weekKey": weekKey, status: "delivered", phoneHash: { $exists: true, $ne: "" } } },
        { $group: { _id: "$phoneHash", orders: { $sum: 1 } } },
      ]),
      Order.countDocuments({ "settlement.weekKey": weekKey, status: "delivered", "discount.source": "promo" }),
      getPromoPolicyForWeek(weekKey),
      Order.aggregate<SourceAggDay>([
        { $match: { createdAt: { $gte: dayStart } } },
        {
          $group: {
            _id: { $ifNull: ["$attribution.source", "organic"] },
            ordersToday: { $sum: 1 },
            deliveredToday: {
              $sum: { $cond: [{ $eq: ["$status", "delivered"] }, 1, 0] },
            },
          },
        },
      ]),
      Order.aggregate<SourceAggWeek>([
        { $match: { "settlement.weekKey": weekKey, status: "delivered" } },
        {
          $group: {
            _id: { $ifNull: ["$attribution.source", "organic"] },
            deliveredCount: { $sum: 1 },
            commissionTotal: { $sum: { $ifNull: ["$commissionAmount", 0] } },
            promoDiscountTotal: {
              $sum: {
                $cond: [
                  { $eq: ["$discount.source", "promo"] },
                  { $ifNull: ["$discount.amount", 0] },
                  0,
                ],
              },
            },
            netSubtotalTotal: { $sum: { $ifNull: ["$subtotal", 0] } },
          },
        },
      ]),
      Order.aggregate<CampaignAggWeek>([
        {
          $match: {
            "settlement.weekKey": weekKey,
            status: "delivered",
            "attribution.campaignId": { $exists: true, $nin: [null, ""] },
          },
        },
        {
          $group: {
            _id: { $toUpper: "$attribution.campaignId" },
            deliveredCount: { $sum: 1 },
            commissionTotal: { $sum: { $ifNull: ["$commissionAmount", 0] } },
            promoDiscountTotal: {
              $sum: {
                $cond: [
                  { $eq: ["$discount.source", "promo"] },
                  { $ifNull: ["$discount.amount", 0] },
                  0,
                ],
              },
            },
          },
        },
        { $sort: { deliveredCount: -1, commissionTotal: -1 } },
        { $limit: 10 },
      ]),
      Business.aggregate<TierAgg>([
        {
          $match: {
            isActive: true,
            isDemo: { $ne: true },
          },
        },
        {
          $group: {
            _id: { $ifNull: ["$performance.tier", "bronze"] },
            count: { $sum: 1 },
          },
        },
      ]),
      Order.aggregate<SlaAvgAgg>([
        {
          $match: {
            status: "delivered",
            "settlement.weekKey": weekKey,
          },
        },
        {
          $group: {
            _id: null,
            avgFirstActionMinutes: { $avg: { $ifNull: ["$sla.firstActionMinutes", null] } },
            avgTotalMinutes: { $avg: { $ifNull: ["$sla.totalMinutes", null] } },
          },
        },
      ]),
      Order.aggregate<SlowestBusinessAgg>([
        {
          $match: {
            status: "delivered",
            "settlement.weekKey": weekKey,
            "sla.totalMinutes": { $exists: true, $ne: null },
          },
        },
        {
          $group: {
            _id: "$businessId",
            businessName: { $first: "$businessName" },
            avgTotalMinutes: { $avg: "$sla.totalMinutes" },
            deliveredCount: { $sum: 1 },
          },
        },
        { $sort: { avgTotalMinutes: -1, deliveredCount: -1 } },
        { $limit: 10 },
      ]),
      Order.aggregate<AcceptanceWeekAgg>([
        {
          $match: {
            "settlement.weekKey": weekKey,
            "statusTimestamps.acceptedAt": { $type: "date" },
            createdAt: { $type: "date" },
          },
        },
        {
          $project: {
            acceptanceMinutes: {
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
          },
        },
        {
          $group: {
            _id: null,
            acceptedCount: { $sum: 1 },
            acceptedWithin7mCount: {
              $sum: { $cond: [{ $lte: ["$acceptanceMinutes", 7] }, 1, 0] },
            },
            avgAcceptanceMinutes: { $avg: "$acceptanceMinutes" },
          },
        },
      ]),
      Order.aggregate<SlowestAcceptanceBusinessAgg>([
        {
          $match: {
            "settlement.weekKey": weekKey,
            "statusTimestamps.acceptedAt": { $type: "date" },
            createdAt: { $type: "date" },
          },
        },
        {
          $project: {
            businessId: "$businessId",
            businessName: "$businessName",
            acceptanceMinutes: {
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
          },
        },
        {
          $group: {
            _id: "$businessId",
            businessName: { $first: "$businessName" },
            avgAcceptanceMinutes: { $avg: "$acceptanceMinutes" },
            acceptedCount: { $sum: 1 },
          },
        },
        { $sort: { avgAcceptanceMinutes: -1, acceptedCount: -1 } },
        { $limit: 10 },
      ]),
      OpsEvent.aggregate<BlockedReasonAgg>([
        {
          $match: {
            weekKey,
            type: "order_blocked",
          },
        },
        {
          $group: {
            _id: "$reason",
            blockedCount: { $sum: 1 },
          },
        },
      ]),
      OpsEvent.aggregate<TopBlockedBusinessAgg>([
        {
          $match: {
            weekKey,
            type: "order_blocked",
          },
        },
        {
          $group: {
            _id: "$businessId",
            businessName: { $first: "$businessName" },
            blockedCount: { $sum: 1 },
          },
        },
        { $sort: { blockedCount: -1, businessName: 1 } },
        { $limit: 10 },
      ]),
      Order.aggregate<RepeatLast7dAgg>([
        {
          $match: {
            status: "delivered",
            createdAt: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
            phoneHash: { $exists: true, $ne: "" },
          },
        },
        { $group: { _id: "$phoneHash", orders: { $sum: 1 } } },
      ]),
      Order.aggregate<RepeatBySourceAgg>([
        {
          $match: {
            status: "delivered",
            createdAt: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
            phoneHash: { $exists: true, $ne: "" },
          },
        },
        {
          $project: {
            source: { $ifNull: ["$attribution.source", "organic"] },
            phoneHash: "$phoneHash",
          },
        },
        {
          $group: {
            _id: { source: "$source", phoneHash: "$phoneHash" },
            orders: { $sum: 1 },
          },
        },
        {
          $group: {
            _id: "$_id.source",
            customers: { $sum: 1 },
            repeatCustomers: {
              $sum: { $cond: [{ $gte: ["$orders", 2] }, 1, 0] },
            },
          },
        },
      ]),
      Order.aggregate<TopRepeatBusinessAgg>([
        {
          $match: {
            status: "delivered",
            createdAt: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
            phoneHash: { $exists: true, $ne: "" },
          },
        },
        {
          $group: {
            _id: {
              businessId: "$businessId",
              businessName: "$businessName",
              phoneHash: "$phoneHash",
            },
            orders: { $sum: 1 },
          },
        },
        {
          $group: {
            _id: {
              businessId: "$_id.businessId",
              businessName: "$_id.businessName",
            },
            customers: { $sum: 1 },
            repeatCustomers: {
              $sum: { $cond: [{ $gte: ["$orders", 2] }, 1, 0] },
            },
          },
        },
        { $sort: { repeatCustomers: -1, customers: -1, "_id.businessName": 1 } },
        { $limit: 10 },
      ]),
      Order.aggregate<DeliveredProofAgg>([
        {
          $match: {
            status: "delivered",
            "settlement.weekKey": weekKey,
          },
        },
        {
          $group: {
            _id: { $ifNull: ["$deliveryProof.verifiedBy", "unverified"] },
            count: { $sum: 1 },
          },
        },
      ]),
      Order.aggregate<TopOverrideBusinessAgg>([
        {
          $match: {
            status: "delivered",
            "settlement.weekKey": weekKey,
            "deliveryProof.verifiedBy": "admin_override",
          },
        },
        {
          $group: {
            _id: "$businessId",
            businessName: { $first: "$businessName" },
            overridesCount: { $sum: 1 },
          },
        },
        { $sort: { overridesCount: -1, businessName: 1 } },
        { $limit: 10 },
      ]),
    ]);

    const [menuQualityMinScore, menuQualityPauseThreshold, menuQualityBusinesses] =
      await Promise.all([
        getNumberSetting("menu_quality_min_score", 60),
        getNumberSetting("menu_quality_pause_threshold", 40),
        Business.find({
          isActive: true,
          isDemo: { $ne: true },
        })
          .select("menuQuality")
          .lean<MenuQualityBusinessRow[]>(),
      ]);

    const missingMenuQualityBusinessIds = menuQualityBusinesses
      .filter((row) => row.menuQuality?.score == null)
      .map((row) => row._id);
    const menuQualityFallback = missingMenuQualityBusinessIds.length
      ? await computeMenuQualityForBusinesses(missingMenuQualityBusinessIds)
      : new Map<string, { menuQualityScore: number }>();
    const menuQualityScores = menuQualityBusinesses.map((row) => {
      const fallback = menuQualityFallback.get(String(row._id));
      const score = fallback ? Number(fallback.menuQualityScore || 0) : Number(row.menuQuality?.score || 0);
      return Math.max(0, Math.min(100, score));
    });
    const menuQualityAvgScore = menuQualityScores.length
      ? Number(
          (
            menuQualityScores.reduce((sum, score) => sum + Number(score || 0), 0) /
            menuQualityScores.length
          ).toFixed(2)
        )
      : 0;
    const safeMenuQualityMinScore = Math.max(
      0,
      Math.min(100, Math.round(Number(menuQualityMinScore || 60)))
    );
    const safeMenuQualityPauseThreshold = Math.max(
      0,
      Math.min(100, Math.round(Number(menuQualityPauseThreshold || 40)))
    );
    const menuQualityCounts = menuQualityScores.reduce(
      (acc, score) => {
        if (score >= 80) acc.top += 1;
        else if (score >= 60) acc.ok += 1;
        else if (score >= 40) acc.low += 1;
        else acc.bad += 1;
        return acc;
      },
      { top: 0, ok: 0, low: 0, bad: 0 }
    );
    const menuQualityBelowMinScore = menuQualityScores.filter(
      (score) => score < safeMenuQualityMinScore
    ).length;
    const menuQualityBelowPauseThreshold = menuQualityScores.filter(
      (score) => score < safeMenuQualityPauseThreshold
    ).length;

    const weekNetSubtotal = await sumValue({ "settlement.weekKey": weekKey, status: "delivered" }, "subtotal");
    const [rateLimitBlockedByRouteAgg, topAbuseIpsAgg, piiRedactionLastRun] = await Promise.all([
      OpsEvent.aggregate<RateLimitBlockedRouteAgg>([
        {
          $match: {
            type: "RATE_LIMIT_BLOCKED",
            createdAt: { $gte: dayStart },
          },
        },
        {
          $group: {
            _id: { $ifNull: ["$meta.route", "unknown"] },
            count: { $sum: 1 },
          },
        },
        { $sort: { count: -1, _id: 1 } },
      ]),
      OpsEvent.aggregate<TopAbuseIpAgg>([
        {
          $match: {
            type: "RATE_LIMIT_BLOCKED",
            createdAt: { $gte: dayStart },
            "meta.ipHash": { $exists: true, $nin: [null, ""] },
          },
        },
        {
          $group: {
            _id: "$meta.ipHash",
            count: { $sum: 1 },
          },
        },
        { $sort: { count: -1, _id: 1 } },
        { $limit: 10 },
      ]),
      OpsEvent.findOne({ type: "PII_REDACT_RUN" })
        .sort({ createdAt: -1 })
        .select("createdAt meta")
        .lean<PiiRedactRunLean | null>(),
    ]);

    const todayUniqueCustomers = Number(todayUniqueAgg[0]?.value || 0);
    const weekUniqueCustomers = Number(weekUniqueAgg[0]?.value || 0);
    const weekRepeatCustomers = weekRepeatAgg.filter((row) => Number(row.orders || 0) >= 2).length;
    const weekRepeatRate = weekUniqueCustomers ? Number((weekRepeatCustomers / weekUniqueCustomers).toFixed(4)) : 0;
    const weekPromoDiscountTotal = Number(promoPolicy.spentRdp || 0);
    const weekCommissionTotal = feeThisWeek;
    const acceptedCountWeek = Number(acceptanceWeekAgg[0]?.acceptedCount || 0);
    const weekAcceptedWithin7mCount = Number(acceptanceWeekAgg[0]?.acceptedWithin7mCount || 0);
    const weekAcceptedWithin7mRate = acceptedCountWeek
      ? Number((weekAcceptedWithin7mCount / acceptedCountWeek).toFixed(4))
      : 0;
    const slowestBusinessesByAcceptanceWeek = slowestAcceptanceWeekAgg.map((row) => ({
      businessId: String(row._id),
      businessName: String(row.businessName || "Business"),
      avgAcceptanceMinutes: Number((row.avgAcceptanceMinutes || 0).toFixed(2)),
      acceptedCount: Number(row.acceptedCount || 0),
    }));
    const weekOrderBlockedCounts = {
      closed: 0,
      busy: 0,
      manual_pause: 0,
      total: 0,
    };
    for (const row of blockedReasonsWeekAgg) {
      const reason = String(row._id || "").trim().toLowerCase();
      const count = Number(row.blockedCount || 0);
      if (reason === "closed" || reason === "busy" || reason === "manual_pause") {
        weekOrderBlockedCounts[reason] = count;
      }
    }
    weekOrderBlockedCounts.total =
      weekOrderBlockedCounts.closed +
      weekOrderBlockedCounts.busy +
      weekOrderBlockedCounts.manual_pause;
    const topBlockedBusinessesWeek = topBlockedBusinessesWeekAgg.map((row) => ({
      businessId: String(row._id),
      businessName: String(row.businessName || "Business"),
      blockedCount: Number(row.blockedCount || 0),
    }));
    const blockedByRateLimitToday = rateLimitBlockedByRouteAgg.map((row) => ({
      route: String(row._id || "unknown"),
      count: Number(row.count || 0),
    }));
    const topAbuseIpsHashedToday = topAbuseIpsAgg.map((row) => ({
      ipHash: String(row._id || ""),
      count: Number(row.count || 0),
    }));
    const piiRedactionLastRunAt = piiRedactionLastRun?.createdAt
      ? new Date(piiRedactionLastRun.createdAt).toISOString()
      : null;
    const piiRedactionLastCounts = {
      ordersScanned: Number(piiRedactionLastRun?.meta?.ordersScanned || 0),
      ordersRedacted: Number(piiRedactionLastRun?.meta?.ordersRedacted || 0),
      complaintsScanned: Number(piiRedactionLastRun?.meta?.complaintsScanned || 0),
      complaintsRedacted: Number(piiRedactionLastRun?.meta?.complaintsRedacted || 0),
    };
    const customersLast7d = repeatLast7dAgg.length;
    const repeatCustomersLast7d = repeatLast7dAgg.filter((row) => Number(row.orders || 0) >= 2).length;
    const repeatRateLast7d = customersLast7d
      ? Number((repeatCustomersLast7d / customersLast7d).toFixed(4))
      : 0;
    const repeatRateLast7dBySource = repeatBySourceLast7dAgg.map((row) => {
      const source = normalizeSource(row._id);
      const customers = Number(row.customers || 0);
      const repeatCustomers = Number(row.repeatCustomers || 0);
      return {
        source,
        customers,
        repeatCustomers,
        repeatRate: customers ? Number((repeatCustomers / customers).toFixed(4)) : 0,
      };
    });
    const topRepeatBusinessesLast7d = topRepeatBusinessesLast7dAgg.map((row) => {
      const customers = Number(row.customers || 0);
      const repeatCustomers = Number(row.repeatCustomers || 0);
      return {
        businessId: String(row._id.businessId),
        businessName: String(row._id.businessName || "Business"),
        customers,
        repeatCustomers,
        repeatRate: customers ? Number((repeatCustomers / customers).toFixed(4)) : 0,
      };
    });
    const deliveredProofCountByType = {
      customer_code: 0,
      admin_override: 0,
      unverified: 0,
    };
    for (const row of deliveredProofWeekAgg) {
      const type = String(row._id || "").trim().toLowerCase();
      const count = Number(row.count || 0);
      if (type === "customer_code" || type === "admin_override" || type === "unverified") {
        deliveredProofCountByType[type] = count;
      }
    }
    const topBusinessesByOverridesWeek = topOverrideBusinessesWeekAgg.map((row) => ({
      businessId: String(row._id),
      businessName: String(row.businessName || "Business"),
      overridesCount: Number(row.overridesCount || 0),
    }));

    const ordersTodayBySource = blankSourceMap();
    const deliveredTodayBySource = blankSourceMap();
    for (const row of todaySourceAgg) {
      const source = normalizeSource(row._id);
      ordersTodayBySource[source] += Number(row.ordersToday || 0);
      deliveredTodayBySource[source] += Number(row.deliveredToday || 0);
    }

    const deliveredWeekBySource = blankSourceMap();
    const commissionWeekBySource = blankSourceMap();
    const promoDiscountWeekBySource = blankSourceMap();
    const netSubtotalWeekBySource = blankSourceMap();
    for (const row of weekSourceAgg) {
      const source = normalizeSource(row._id);
      deliveredWeekBySource[source] += Number(row.deliveredCount || 0);
      commissionWeekBySource[source] += Number(row.commissionTotal || 0);
      promoDiscountWeekBySource[source] += Number(row.promoDiscountTotal || 0);
      netSubtotalWeekBySource[source] += Number(row.netSubtotalTotal || 0);
    }

    const topCampaignsWeek = topCampaignsWeekAgg
      .map((row) => ({
        campaignId: String(row._id || "").trim(),
        deliveredCount: Number(row.deliveredCount || 0),
        commissionTotal: Number(row.commissionTotal || 0),
        promoDiscountTotal: Number(row.promoDiscountTotal || 0),
      }))
      .filter((row) => row.campaignId.length > 0);

    const merchantTierCounts = {
      gold: 0,
      silver: 0,
      bronze: 0,
      probation: 0,
    };
    for (const row of merchantTierAgg) {
      const tier = String(row._id || "").trim().toLowerCase();
      if (tier === "gold" || tier === "silver" || tier === "bronze" || tier === "probation") {
        merchantTierCounts[tier] = Number(row.count || 0);
      }
    }
    const weekAvgFirstActionMinutes = Number(slaAvgAgg[0]?.avgFirstActionMinutes || 0);
    const weekAvgTotalMinutes = Number(slaAvgAgg[0]?.avgTotalMinutes || 0);
    const slowestBusinessesWeek = slowestBusinessesAgg.map((row) => ({
      businessId: String(row._id),
      businessName: String(row.businessName || "Business"),
      avgTotalMinutes: Number((row.avgTotalMinutes || 0).toFixed(2)),
      deliveredCount: Number(row.deliveredCount || 0),
    }));

    return ok({
      weekKey,
      kpis: {
        businessesActive,
        ordersToday,
        ordersThisWeek,
        commissionToday,
        feeThisWeek,
        ordersWeeklyGrowthPct: growthPct(deliveredThisWeek, deliveredPrevWeek),
        commissionWeeklyGrowthPct: growthPct(feeThisWeek, feePrevWeek),
        activeBusinesses,
        churnedBusinesses,
        repeatCustomerRate: weekRepeatRate,
        todayUniqueCustomers,
        weekUniqueCustomers,
        weekRepeatCustomers,
        weekRepeatRate,
        weekPromoOrders: promoOrdersCount,
        weekPromoDiscountTotal,
        weekNetSubtotal,
        weekCommissionTotal,
        weekDeliveredCount: deliveredThisWeek,
        weekAcceptedCount: acceptedCountWeek,
        weekAcceptedWithin7mCount,
        weekAcceptedWithin7mRate,
        customersLast7d,
        repeatCustomersLast7d,
        repeatRateLast7d,
        repeatRateLast7dBySource,
        weekDeliveredVerifiedCount: deliveredProofCountByType.customer_code,
        weekDeliveredOverrideCount: deliveredProofCountByType.admin_override,
        weekDeliveredUnverifiedCount: deliveredProofCountByType.unverified,
        weekOrderBlockedCounts,
        promosEnabled: promoPolicy.promosEnabled,
        promoBudgetWeeklyRdp: Number(promoPolicy.weeklyBudgetRdp || 0),
        promoDiscountSpentThisWeekRdp: Number(promoPolicy.spentRdp || 0),
        promoBudgetRemainingThisWeekRdp: Number(promoPolicy.remainingRdp || 0),
        ordersTodayBySource,
        deliveredTodayBySource,
        deliveredWeekBySource,
        commissionWeekBySource,
        promoDiscountWeekBySource,
        netSubtotalWeekBySource,
        merchantTierCounts,
        weekAvgFirstActionMinutes: Number(weekAvgFirstActionMinutes.toFixed(2)),
        weekAvgTotalMinutes: Number(weekAvgTotalMinutes.toFixed(2)),
        menuQuality: {
          avgScore: menuQualityAvgScore,
          businessesBelowMinScore: menuQualityBelowMinScore,
          businessesBelowPauseThreshold: menuQualityBelowPauseThreshold,
        },
        menuQualityCounts,
        blockedByRateLimitToday,
        piiRedactionLastRunAt,
        piiRedactionLastCounts,
        piiRetentionDays: Number(ENV_PII_PHONE_RETENTION_DAYS || 30),
        topAbuseIpsHashedToday,
      },
      topCampaignsWeek,
      slowestBusinessesWeek,
      slowestBusinessesByAcceptanceWeek,
      topRepeatBusinessesLast7d,
      topBlockedBusinessesWeek,
      topBusinessesByOverridesWeek,
      topBusinesses,
    });
  } catch (error: unknown) {
    const err = error as ApiError;
    return fail(err.code || "SERVER_ERROR", err.message || "Could not load metrics.", err.status || 500);
  }
}
