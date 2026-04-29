import mongoose from "mongoose";
import { dbConnect } from "@/lib/mongodb";
import { ok, fail } from "@/lib/apiResponse";
import { requireAdminKey } from "@/lib/adminAuth";
import { assertNotInMaintenance } from "@/lib/maintenance";
import { getWeekBounds, listOpsVisibleCities, parseWeekKeyOrThrow } from "@/lib/opsAnalytics";
import { Order } from "@/models/Order";
import { RiderPayout } from "@/models/RiderPayout";

type ApiError = Error & { status?: number; code?: string };

export type BreakdownRow = {
  cityId: string;
  code: string;
  name: string;
  ordersTotal: number;
  delivered: number;
  cancelled: number;
  commissionTotal: number;
  platformDeliveryMarginTotal: number;
  riderPayoutTotal: number;
  assignedCount: number;
  unassignedCount: number;
};

function toNumber(value: unknown) {
  const num = Number(value || 0);
  return Number.isFinite(num) ? num : 0;
}

const CONCURRENCY_LIMIT = 4;

async function mapInBatches<T, R>(items: T[], limit: number, mapper: (item: T) => Promise<R>) {
  const results: R[] = [];
  for (let i = 0; i < items.length; i += limit) {
    const chunk = items.slice(i, i + limit);
    const chunkResults = await Promise.all(chunk.map((item) => mapper(item)));
    results.push(...chunkResults);
  }
  return results;
}

export async function loadBreakdownRows(weekKey: string): Promise<BreakdownRow[]> {
  const bounds = getWeekBounds(weekKey, new Date());
  const cities = await listOpsVisibleCities();

  const rows = await mapInBatches(cities, CONCURRENCY_LIMIT, async (city) => {
    const cityObjectId = new mongoose.Types.ObjectId(String(city._id));
    const createdAtMatch = { createdAt: { $gte: bounds.start, $lt: bounds.end } };

    const [ordersAgg, payoutsAgg] = await Promise.all([
      Order.aggregate<{
        ordersTotal: number;
        delivered: number;
        cancelled: number;
        commissionTotal: number;
        assignedCount: number;
        unassignedCount: number;
      }>([
        {
          $match: {
            cityId: cityObjectId,
            ...createdAtMatch,
          },
        },
        {
          $group: {
            _id: null,
            ordersTotal: { $sum: 1 },
            delivered: { $sum: { $cond: [{ $eq: ["$status", "delivered"] }, 1, 0] } },
            cancelled: { $sum: { $cond: [{ $eq: ["$status", "cancelled"] }, 1, 0] } },
            commissionTotal: { $sum: "$commissionAmount" },
            assignedCount: {
              $sum: {
                $cond: [
                  {
                    $and: [
                      { $ne: ["$dispatch.assignedDriverId", null] },
                      { $ifNull: ["$dispatch.assignedDriverId", false] },
                    ],
                  },
                  1,
                  0,
                ],
              },
            },
            unassignedCount: {
              $sum: {
                $cond: [
                  {
                    $and: [
                      { $not: [{ $in: ["$status", ["delivered", "cancelled"]] }] },
                      {
                        $or: [
                          { $eq: ["$dispatch.assignedDriverId", null] },
                          { $not: [{ $ifNull: ["$dispatch.assignedDriverId", false] }] },
                        ],
                      },
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
      RiderPayout.aggregate<{
        platformDeliveryMarginTotal: number;
        riderPayoutTotal: number;
      }>([
        {
          $match: {
            cityId: cityObjectId,
            weekKey,
            status: { $ne: "void" },
          },
        },
        {
          $group: {
            _id: null,
            platformDeliveryMarginTotal: { $sum: "$platformMargin" },
            riderPayoutTotal: { $sum: "$amount" },
          },
        },
      ]),
    ]);

    const orders = ordersAgg?.[0] || {};
    const payouts = payoutsAgg?.[0] || {};

    return {
      cityId: String(city._id),
      code: String(city.code || ""),
      name: String(city.name || ""),
      ordersTotal: toNumber(orders.ordersTotal),
      delivered: toNumber(orders.delivered),
      cancelled: toNumber(orders.cancelled),
      commissionTotal: toNumber(orders.commissionTotal),
      platformDeliveryMarginTotal: toNumber(payouts.platformDeliveryMarginTotal),
      riderPayoutTotal: toNumber(payouts.riderPayoutTotal),
      assignedCount: toNumber(orders.assignedCount),
      unassignedCount: toNumber(orders.unassignedCount),
    };
  });

  rows.sort((a, b) => {
    if (b.delivered !== a.delivered) return b.delivered - a.delivered;
    if (b.ordersTotal !== a.ordersTotal) return b.ordersTotal - a.ordersTotal;
    return a.name.localeCompare(b.name);
  });

  return rows;
}

export async function GET(req: Request) {
  try {
    requireAdminKey(req);
    await assertNotInMaintenance();
    await dbConnect();

    const url = new URL(req.url);
    const weekKey = parseWeekKeyOrThrow(url.searchParams.get("weekKey"), new Date());

    const rows = await loadBreakdownRows(weekKey);

    return ok({
      weekKey,
      rows,
    });
  } catch (error: unknown) {
    const err = error as ApiError;
    return fail(
      err.code || "SERVER_ERROR",
      err.message || "Could not load analytics breakdown.",
      err.status || 500
    );
  }
}
