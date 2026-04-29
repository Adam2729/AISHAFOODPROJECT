import mongoose from "mongoose";
import { dbConnect } from "@/lib/mongodb";
import { ok, fail } from "@/lib/apiResponse";
import { requireAdminKey } from "@/lib/adminAuth";
import { assertNotInMaintenance } from "@/lib/maintenance";
import {
  buildOrderRangeMatch,
  buildRiderPayoutRangeMatch,
  listOpsVisibleCities,
  resolveRangeFromQuery,
} from "@/lib/opsAnalytics";
import { Order } from "@/models/Order";
import { RiderPayout } from "@/models/RiderPayout";

type ApiError = Error & { status?: number; code?: string };

function toNumber(value: unknown) {
  const num = Number(value || 0);
  return Number.isFinite(num) ? num : 0;
}

type CityRow = {
  cityId: string;
  cityCode: string;
  cityName: string;
  metrics: {
    ordersTotal: number;
    delivered: number;
    cancelled: number;
  };
  finance: {
    commissionTotal: number;
    platformDeliveryMarginTotal: number;
    netPlatformTakeApprox: number;
  };
  dispatch: {
    assignedCount: number;
    unassignedCount: number;
  };
};

const CONCURRENCY_LIMIT = 4;

async function mapInBatches<T, R>(
  items: T[],
  limit: number,
  mapper: (item: T) => Promise<R>
) {
  const results: R[] = [];
  for (let i = 0; i < items.length; i += limit) {
    const chunk = items.slice(i, i + limit);
    const chunkResults = await Promise.all(chunk.map((item) => mapper(item)));
    results.push(...chunkResults);
  }
  return results;
}

export async function GET(req: Request) {
  try {
    requireAdminKey(req);
    await assertNotInMaintenance();
    await dbConnect();

    const range = resolveRangeFromQuery(new URL(req.url));
    const cities = await listOpsVisibleCities();

    const rows = await mapInBatches(cities, CONCURRENCY_LIMIT, async (city) => {
      const cityObjectId = new mongoose.Types.ObjectId(String(city._id));

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
              ...buildOrderRangeMatch(range),
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
        }>([
          {
            $match: {
              cityId: cityObjectId,
              ...buildRiderPayoutRangeMatch(range),
              status: { $ne: "void" },
            },
          },
          {
            $group: {
              _id: null,
              platformDeliveryMarginTotal: { $sum: "$platformMargin" },
            },
          },
        ]),
      ]);

      const commissionTotal = toNumber(ordersAgg[0]?.commissionTotal);
      const platformDeliveryMarginTotal = toNumber(payoutsAgg[0]?.platformDeliveryMarginTotal);
      const row: CityRow = {
        cityId: String(city._id),
        cityCode: String(city.code || ""),
        cityName: String(city.name || ""),
        metrics: {
          ordersTotal: toNumber(ordersAgg[0]?.ordersTotal),
          delivered: toNumber(ordersAgg[0]?.delivered),
          cancelled: toNumber(ordersAgg[0]?.cancelled),
        },
        finance: {
          commissionTotal,
          platformDeliveryMarginTotal,
          netPlatformTakeApprox: commissionTotal + platformDeliveryMarginTotal,
        },
        dispatch: {
          assignedCount: toNumber(ordersAgg[0]?.assignedCount),
          unassignedCount: toNumber(ordersAgg[0]?.unassignedCount),
        },
      };
      return row;
    });

    rows.sort((a, b) => a.cityName.localeCompare(b.cityName));

    return ok({
      weekKey: range.weekKey,
      range: {
        fromIso: range.fromIso,
        toIso: range.toIso,
        mode: range.mode,
      },
      rows,
    });
  } catch (error: unknown) {
    const err = error as ApiError;
    return fail(
      err.code || "SERVER_ERROR",
      err.message || "Could not load analytics city breakdown.",
      err.status || 500
    );
  }
}
