import mongoose from "mongoose";
import { dbConnect } from "@/lib/mongodb";
import { ok, fail } from "@/lib/apiResponse";
import { requireAdminKey } from "@/lib/adminAuth";
import { getWeekKey } from "@/lib/geo";
import { computeSubscriptionStatus } from "@/lib/subscription";
import { runSubscriptionStatusJob } from "@/lib/subscriptionJob";
import { Business } from "@/models/Business";
import { Order } from "@/models/Order";

type ApiError = Error & { status?: number; code?: string };

type TopBusinessAgg = {
  _id: mongoose.Types.ObjectId;
  orders: number;
  subtotal: number;
};

type RepeatAgg = {
  _id: string;
  orders: number;
};

type SubscriptionInput = {
  trialEndsAt?: Date | string | null;
  paidUntilAt?: Date | string | null;
  graceDays?: number | null;
};

function growthPct(current: number, previous: number) {
  if (previous <= 0) return current > 0 ? 100 : 0;
  return Number((((current - previous) / previous) * 100).toFixed(2));
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

    const businesses = await Business.find({ isActive: true })
      .select("name subscription")
      .lean();
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

    const feeAgg = await Order.aggregate<{ _id: null; feeTotal: number }>([
      { $match: { "settlement.weekKey": weekKey, status: "delivered" } },
      { $group: { _id: null, feeTotal: { $sum: "$commissionAmount" } } },
    ]);
    const feeThisWeek = Number(feeAgg[0]?.feeTotal || 0);

    const feePrevAgg = await Order.aggregate<{ _id: null; feeTotal: number }>([
      { $match: { "settlement.weekKey": prevWeekKey, status: "delivered" } },
      { $group: { _id: null, feeTotal: { $sum: "$commissionAmount" } } },
    ]);
    const feePrevWeek = Number(feePrevAgg[0]?.feeTotal || 0);

    const feeTodayAgg = await Order.aggregate<{ _id: null; feeTotal: number }>([
      { $match: { createdAt: { $gte: dayStart }, status: "delivered" } },
      { $group: { _id: null, feeTotal: { $sum: "$commissionAmount" } } },
    ]);
    const commissionToday = Number(feeTodayAgg[0]?.feeTotal || 0);

    const topRaw = await Order.aggregate<TopBusinessAgg>([
      { $match: { "settlement.weekKey": weekKey, status: "delivered" } },
      { $group: { _id: "$businessId", orders: { $sum: 1 }, subtotal: { $sum: "$subtotal" } } },
      { $sort: { orders: -1 } },
      { $limit: 5 },
    ]);

    const byBusinessId = new Map(topRaw.map((x) => [String(x._id), x]));
    const topBusinessesDocs = await Business.find({
      _id: { $in: topRaw.map((x) => x._id) },
    })
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

    const repeatAgg = await Order.aggregate<RepeatAgg>([
      { $match: { createdAt: { $gte: last30Days } } },
      { $group: { _id: "$phone", orders: { $sum: 1 } } },
    ]);
    const totalCustomers = repeatAgg.length;
    const repeatCustomers = repeatAgg.filter((x) => x.orders > 1).length;
    const repeatCustomerRate = totalCustomers ? Number((repeatCustomers / totalCustomers).toFixed(4)) : 0;

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
        repeatCustomerRate,
      },
      topBusinesses,
    });
  } catch (e: unknown) {
    const err = e as ApiError;
    return fail(err.code || "SERVER_ERROR", err.message || "Could not load metrics.", err.status || 500);
  }
}
