import mongoose from "mongoose";
import { ok, fail } from "@/lib/apiResponse";
import { requireAdminKey } from "@/lib/adminAuth";
import { getWeekKey } from "@/lib/geo";
import { dbConnect } from "@/lib/mongodb";
import { getBoolSetting, getNumberSetting } from "@/lib/appSettings";
import { PromoSpendEvent } from "@/models/PromoSpendEvent";
import { Business } from "@/models/Business";

type ApiError = Error & { status?: number; code?: string };

type TopPromoAgg = {
  _id: string;
  spendRdp: number;
  orders: number;
};

type TopBusinessAgg = {
  _id: mongoose.Types.ObjectId;
  spendRdp: number;
  orders: number;
};

type DailyAgg = {
  _id: string;
  spendRdp: number;
};

function parseLimit(raw: string | null) {
  const parsed = Number(raw || 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return 10;
  return Math.min(50, Math.floor(parsed));
}

function getIsoWeekStart(now = new Date()) {
  const utc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const day = utc.getUTCDay() || 7;
  utc.setUTCDate(utc.getUTCDate() - day + 1);
  utc.setUTCHours(0, 0, 0, 0);
  return utc;
}

function getElapsedIsoWeekDays(now = new Date()) {
  const start = getIsoWeekStart(now);
  const diffMs = now.getTime() - start.getTime();
  return Math.max(1, Math.min(7, Math.floor(diffMs / (24 * 60 * 60 * 1000)) + 1));
}

function parseIsoWeekStart(weekKey: string): Date | null {
  const match = /^(\d{4})-W(\d{2})$/.exec(String(weekKey || "").trim());
  if (!match) return null;
  const year = Number(match[1]);
  const week = Number(match[2]);
  if (!Number.isFinite(year) || !Number.isFinite(week) || week < 1 || week > 53) return null;

  const jan4 = new Date(Date.UTC(year, 0, 4));
  const jan4Day = jan4.getUTCDay() || 7;
  const week1Monday = new Date(jan4);
  week1Monday.setUTCDate(jan4.getUTCDate() - jan4Day + 1);
  week1Monday.setUTCHours(0, 0, 0, 0);

  const target = new Date(week1Monday);
  target.setUTCDate(week1Monday.getUTCDate() + (week - 1) * 7);
  target.setUTCHours(0, 0, 0, 0);
  return target;
}

function getElapsedWeekDaysForKey(weekKey: string, now = new Date()) {
  const start = parseIsoWeekStart(weekKey);
  if (!start) return getElapsedIsoWeekDays(now);

  const startMs = start.getTime();
  const endMs = startMs + 7 * 24 * 60 * 60 * 1000;
  const nowMs = now.getTime();
  if (nowMs <= startMs) return 1;
  if (nowMs >= endMs) return 7;
  return Math.max(1, Math.min(7, Math.floor((nowMs - startMs) / (24 * 60 * 60 * 1000)) + 1));
}

export async function GET(req: Request) {
  try {
    requireAdminKey(req);
    const url = new URL(req.url);
    const weekKey = String(url.searchParams.get("weekKey") || "").trim() || getWeekKey(new Date());
    const limit = parseLimit(url.searchParams.get("limit"));

    await dbConnect();
    const [promosEnabled, weeklyBudgetRdpRaw, topPromos, topBusinessesRaw, dailySpendRaw] = await Promise.all([
      getBoolSetting("promos_enabled", true),
      getNumberSetting("promo_budget_weekly_rdp", 5000),
      PromoSpendEvent.aggregate<TopPromoAgg>([
        { $match: { weekKey } },
        {
          $group: {
            _id: "$code",
            spendRdp: { $sum: { $ifNull: ["$amount", 0] } },
            orders: { $sum: 1 },
          },
        },
        { $sort: { spendRdp: -1, orders: -1 } },
        { $limit: limit },
      ]).option({ maxTimeMS: 15000 }),
      PromoSpendEvent.aggregate<TopBusinessAgg>([
        { $match: { weekKey } },
        {
          $group: {
            _id: "$businessId",
            spendRdp: { $sum: { $ifNull: ["$amount", 0] } },
            orders: { $sum: 1 },
          },
        },
        { $sort: { spendRdp: -1, orders: -1 } },
        { $limit: limit },
      ]).option({ maxTimeMS: 15000 }),
      PromoSpendEvent.aggregate<DailyAgg>([
        { $match: { weekKey } },
        {
          $group: {
            _id: {
              $dateToString: {
                date: "$createdAt",
                format: "%Y-%m-%d",
                timezone: "UTC",
              },
            },
            spendRdp: { $sum: { $ifNull: ["$amount", 0] } },
          },
        },
        { $sort: { _id: 1 } },
      ]).option({ maxTimeMS: 15000 }),
    ]);

    const businessIds = topBusinessesRaw.map((row) => row._id);
    const businesses = await Business.find({ _id: { $in: businessIds } })
      .select("name")
      .lean();
    const businessNameById = new Map(businesses.map((b) => [String(b._id), String(b.name || "")]));
    const topBusinesses = topBusinessesRaw.map((row) => ({
      businessId: String(row._id),
      businessName: businessNameById.get(String(row._id)) || "(unknown)",
      spendRdp: Number(row.spendRdp || 0),
      orders: Number(row.orders || 0),
    }));

    const elapsedDays = getElapsedWeekDaysForKey(weekKey, new Date());
    const spentRdp = dailySpendRaw.reduce((sum, row) => sum + Number(row.spendRdp || 0), 0);
    const weeklyBudgetRdp = Math.max(0, Number(weeklyBudgetRdpRaw || 0));
    const remainingRdp = Math.max(0, weeklyBudgetRdp - spentRdp);
    const overBudgetRdp = Math.max(0, spentRdp - weeklyBudgetRdp);
    const burnRatePerDayRdp = elapsedDays > 0 ? Number((spentRdp / elapsedDays).toFixed(2)) : 0;

    return ok({
      weekKey,
      summary: {
        promosEnabled: Boolean(promosEnabled),
        weeklyBudgetRdp,
        spentRdp,
        remainingRdp,
        overBudgetRdp,
        burnRatePerDayRdp,
        elapsedDays,
      },
      dailySpend: dailySpendRaw.map((row) => ({
        date: row._id,
        amount: Number(row.spendRdp || 0),
      })),
      topPromos: topPromos.map((row) => ({
        code: String(row._id || "").toUpperCase(),
        spendRdp: Number(row.spendRdp || 0),
        orders: Number(row.orders || 0),
      })),
      topBusinesses,
    });
  } catch (e: unknown) {
    const err = e as ApiError;
    return fail(
      err.code || "SERVER_ERROR",
      err.message || "Could not load promo spend insights.",
      err.status || 500
    );
  }
}
