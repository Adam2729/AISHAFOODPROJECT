import mongoose from "mongoose";
import { dbConnect } from "@/lib/mongodb";
import { ok, fail } from "@/lib/apiResponse";
import { requireAdminKey } from "@/lib/adminAuth";
import { FunnelEvent } from "@/models/FunnelEvent";
import { Business } from "@/models/Business";

type ApiError = Error & { status?: number; code?: string };
type FunnelEventName =
  | "business_view"
  | "add_to_cart"
  | "checkout_start"
  | "order_success"
  | "order_fail";

type EventCountRow = {
  _id: FunnelEventName;
  count: number;
};

type SourceCountRow = {
  _id: {
    source: string;
    event: FunnelEventName;
  };
  count: number;
};

type BusinessCountRow = {
  _id: {
    businessId: mongoose.Types.ObjectId;
    event: FunnelEventName;
  };
  count: number;
  businessType: string;
};

type FailCodeRow = {
  _id: string | null;
  count: number;
};

function safeNumber(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseDays(raw: string | null) {
  const parsed = Number(raw || 7);
  if (!Number.isFinite(parsed)) return 7;
  return Math.max(1, Math.min(30, Math.floor(parsed)));
}

function rate(numerator: number, denominator: number) {
  if (denominator <= 0) return 0;
  return Number((numerator / denominator).toFixed(4));
}

function tierToTrustBadge(tier: string) {
  const normalized = String(tier || "").trim().toLowerCase();
  if (normalized === "gold") return "top";
  if (normalized === "silver") return "good";
  if (normalized === "probation") return "at_risk";
  return "new";
}

export async function GET(req: Request) {
  try {
    requireAdminKey(req);
    const url = new URL(req.url);
    const days = parseDays(url.searchParams.get("days"));
    const end = new Date();
    const start = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    await dbConnect();
    const [eventCountsRaw, sourceCountsRaw, businessCountsRaw, failCodesRaw] = await Promise.all([
      FunnelEvent.aggregate<EventCountRow>([
        { $match: { createdAt: { $gte: start, $lte: end } } },
        { $group: { _id: "$event", count: { $sum: 1 } } },
      ]),
      FunnelEvent.aggregate<SourceCountRow>([
        { $match: { createdAt: { $gte: start, $lte: end } } },
        {
          $group: {
            _id: { source: "$source", event: "$event" },
            count: { $sum: 1 },
          },
        },
      ]),
      FunnelEvent.aggregate<BusinessCountRow>([
        { $match: { createdAt: { $gte: start, $lte: end } } },
        {
          $group: {
            _id: { businessId: "$businessId", event: "$event" },
            count: { $sum: 1 },
            businessType: { $first: "$businessType" },
          },
        },
      ]),
      FunnelEvent.aggregate<FailCodeRow>([
        {
          $match: {
            createdAt: { $gte: start, $lte: end },
            event: "order_fail",
          },
        },
        {
          $group: {
            _id: "$meta.failCode",
            count: { $sum: 1 },
          },
        },
        { $sort: { count: -1, _id: 1 } },
        { $limit: 20 },
      ]),
    ]);

    const totals = {
      business_view: 0,
      add_to_cart: 0,
      checkout_start: 0,
      order_success: 0,
      order_fail: 0,
    };
    for (const row of eventCountsRaw) {
      totals[row._id] = safeNumber(row.count, 0);
    }

    const rates = {
      viewToAddRate: rate(totals.add_to_cart, totals.business_view),
      addToCheckoutRate: rate(totals.checkout_start, totals.add_to_cart),
      checkoutToOrderRate: rate(totals.order_success, totals.checkout_start),
    };

    const sourceMap = new Map<
      string,
      {
        source: string;
        business_view: number;
        add_to_cart: number;
        checkout_start: number;
        order_success: number;
        order_fail: number;
      }
    >();
    for (const row of sourceCountsRaw) {
      const source = String(row._id?.source || "unknown");
      const event = row._id?.event;
      if (!sourceMap.has(source)) {
        sourceMap.set(source, {
          source,
          business_view: 0,
          add_to_cart: 0,
          checkout_start: 0,
          order_success: 0,
          order_fail: 0,
        });
      }
      const current = sourceMap.get(source)!;
      current[event] = safeNumber(row.count, 0);
    }
    const bySource = Array.from(sourceMap.values())
      .map((row) => ({
        ...row,
        viewToAddRate: rate(row.add_to_cart, row.business_view),
        addToCheckoutRate: rate(row.checkout_start, row.add_to_cart),
        checkoutToOrderRate: rate(row.order_success, row.checkout_start),
      }))
      .sort((a, b) => b.business_view - a.business_view);

    const businessMap = new Map<
      string,
      {
        businessId: string;
        businessType: string;
        business_view: number;
        add_to_cart: number;
        checkout_start: number;
        order_success: number;
        order_fail: number;
      }
    >();
    for (const row of businessCountsRaw) {
      const businessId = String(row._id?.businessId || "");
      const event = row._id?.event;
      if (!businessId) continue;
      if (!businessMap.has(businessId)) {
        businessMap.set(businessId, {
          businessId,
          businessType: String(row.businessType || "unknown"),
          business_view: 0,
          add_to_cart: 0,
          checkout_start: 0,
          order_success: 0,
          order_fail: 0,
        });
      }
      businessMap.get(businessId)![event] = safeNumber(row.count, 0);
    }

    const businessRows = Array.from(businessMap.values()).map((row) => ({
      ...row,
      viewToAddRate: rate(row.add_to_cart, row.business_view),
      addToCheckoutRate: rate(row.checkout_start, row.add_to_cart),
      checkoutToOrderRate: rate(row.order_success, row.checkout_start),
    }));

    const dropoffCandidates = businessRows
      .filter((row) => row.business_view >= 20)
      .sort((a, b) => {
        if (a.checkoutToOrderRate !== b.checkoutToOrderRate) {
          return a.checkoutToOrderRate - b.checkoutToOrderRate;
        }
        return b.business_view - a.business_view;
      })
      .slice(0, 50);

    const dropoffBusinessIds = dropoffCandidates
      .map((row) => row.businessId)
      .filter((id) => mongoose.Types.ObjectId.isValid(id))
      .map((id) => new mongoose.Types.ObjectId(id));
    const businesses = dropoffBusinessIds.length
      ? await Business.find({ _id: { $in: dropoffBusinessIds } })
          .select("name menuQuality.score performance.tier paused pausedReason")
          .lean()
      : [];
    const businessInfoMap = new Map(businesses.map((row) => [String(row._id), row]));

    const topDropoffBusinesses = dropoffCandidates
      .map((row) => {
        const business = businessInfoMap.get(row.businessId);
        return {
          businessId: row.businessId,
          businessName: String((business as { name?: string } | undefined)?.name || "Business"),
          businessType: row.businessType,
          menuQualityScore: Math.round(
            safeNumber((business as { menuQuality?: { score?: number } } | undefined)?.menuQuality?.score, 0)
          ),
          trustBadge: tierToTrustBadge(
            String((business as { performance?: { tier?: string } } | undefined)?.performance?.tier || "")
          ),
          paused: Boolean((business as { paused?: boolean } | undefined)?.paused),
          pausedReason: String((business as { pausedReason?: string } | undefined)?.pausedReason || ""),
          business_view: row.business_view,
          add_to_cart: row.add_to_cart,
          checkout_start: row.checkout_start,
          order_success: row.order_success,
          order_fail: row.order_fail,
          viewToAddRate: row.viewToAddRate,
          addToCheckoutRate: row.addToCheckoutRate,
          checkoutToOrderRate: row.checkoutToOrderRate,
        };
      })
      .slice(0, 20);

    const topFailCodes = failCodesRaw.map((row) => ({
      failCode: String(row._id || "UNKNOWN"),
      count: safeNumber(row.count, 0),
    }));

    return ok({
      window: {
        start: start.toISOString(),
        end: end.toISOString(),
        days,
      },
      totals,
      rates,
      bySource,
      topDropoffBusinesses,
      topFailCodes,
    });
  } catch (error: unknown) {
    const err = error as ApiError;
    return fail(
      err.code || "SERVER_ERROR",
      err.message || "Could not load funnel metrics.",
      err.status || 500
    );
  }
}

