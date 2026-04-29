import mongoose from "mongoose";
import { dbConnect } from "@/lib/mongodb";
import { ok, fail } from "@/lib/apiResponse";
import { requireAdminKey } from "@/lib/adminAuth";
import { assertNotInMaintenance } from "@/lib/maintenance";
import { CityLean, cityCode, requireActiveCity, resolveCityFromRequest } from "@/lib/city";
import { buildCreatedAtWeekMatch, parseWeekKeyOrThrow } from "@/lib/opsAnalytics";
import { Order } from "@/models/Order";
import { RiderPayout } from "@/models/RiderPayout";

type ApiError = Error & { status?: number; code?: string };

type CitySummaryInput = Pick<CityLean, "_id" | "code" | "name" | "currency">;

export type CityWeekSummary = {
  city: {
    cityId: string;
    code: string;
    name: string;
    currency: string;
  };
  weekKey: string;
  metrics: {
    ordersTotal: number;
    delivered: number;
    cancelled: number;
    new: number;
    acceptanceRate: number | null;
  };
  finance: {
    grossSubtotalTotal: number;
    commissionTotal: number;
    deliveryFeeToCustomerTotal: number;
    platformDeliveryMarginTotal: number;
    riderPayoutTotal: number;
    netPlatformFromDelivery: number;
  };
  dispatch: {
    assignedCount: number;
    unassignedCount: number;
  };
};

function toNumber(value: unknown) {
  const num = Number(value || 0);
  return Number.isFinite(num) ? num : 0;
}

export async function loadCityWeekSummary(
  city: CitySummaryInput,
  weekKey: string
): Promise<CityWeekSummary> {
  const cityObjectId = new mongoose.Types.ObjectId(String(city._id));

  const [ordersAgg, payoutsAgg] = await Promise.all([
    Order.aggregate<{
      ordersTotal: number;
      delivered: number;
      cancelled: number;
      newCount: number;
      acceptedCount: number;
      grossSubtotalTotal: number;
      commissionTotal: number;
      deliveryFeeToCustomerTotal: number;
      assignedCount: number;
      unassignedCount: number;
    }>([
      {
        $match: {
          cityId: cityObjectId,
          ...buildCreatedAtWeekMatch(weekKey, new Date()),
        },
      },
      {
        $group: {
          _id: null,
          ordersTotal: { $sum: 1 },
          delivered: { $sum: { $cond: [{ $eq: ["$status", "delivered"] }, 1, 0] } },
          cancelled: { $sum: { $cond: [{ $eq: ["$status", "cancelled"] }, 1, 0] } },
          newCount: { $sum: { $cond: [{ $eq: ["$status", "new"] }, 1, 0] } },
          acceptedCount: {
            $sum: {
              $cond: [
                {
                  $in: [
                    "$status",
                    ["accepted", "preparing", "ready", "out_for_delivery", "delivered"],
                  ],
                },
                1,
                0,
              ],
            },
          },
          grossSubtotalTotal: { $sum: "$subtotal" },
          commissionTotal: { $sum: "$commissionAmount" },
          deliveryFeeToCustomerTotal: { $sum: "$deliveryFeeToCustomer" },
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
      riderPayoutTotal: number;
      platformDeliveryMarginTotal: number;
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
          riderPayoutTotal: { $sum: "$amount" },
          platformDeliveryMarginTotal: { $sum: "$platformMargin" },
        },
      },
    ]),
  ]);

  const orders = ordersAgg?.[0] || {};
  const payouts = payoutsAgg?.[0] || {};

  const ordersTotal = toNumber(orders.ordersTotal);
  const delivered = toNumber(orders.delivered);
  const cancelled = toNumber(orders.cancelled);
  const newCount = toNumber(orders.newCount);
  const acceptedCount = toNumber(orders.acceptedCount);
  const acceptanceRate = ordersTotal > 0 ? Number((acceptedCount / ordersTotal).toFixed(3)) : null;

  const platformDeliveryMarginTotal = toNumber(payouts.platformDeliveryMarginTotal);
  const riderPayoutTotal = toNumber(payouts.riderPayoutTotal);

  return {
    city: {
      cityId: String(city._id),
      code: cityCode(city),
      name: String(city.name || ""),
      currency: String(city.currency || ""),
    },
    weekKey,
    metrics: {
      ordersTotal,
      delivered,
      cancelled,
      new: newCount,
      acceptanceRate,
    },
    finance: {
      grossSubtotalTotal: toNumber(orders.grossSubtotalTotal),
      commissionTotal: toNumber(orders.commissionTotal),
      deliveryFeeToCustomerTotal: toNumber(orders.deliveryFeeToCustomerTotal),
      platformDeliveryMarginTotal,
      riderPayoutTotal,
      netPlatformFromDelivery: platformDeliveryMarginTotal,
    },
    dispatch: {
      assignedCount: toNumber(orders.assignedCount),
      unassignedCount: toNumber(orders.unassignedCount),
    },
  };
}

export async function GET(req: Request) {
  try {
    requireAdminKey(req);
    await assertNotInMaintenance();
    await dbConnect();

    const selectedCity = await resolveCityFromRequest(req);
    requireActiveCity({
      isActive: Boolean(selectedCity.isActive),
      code: String(selectedCity.code || ""),
      name: String(selectedCity.name || ""),
      country: String(selectedCity.country || ""),
    });

    const url = new URL(req.url);
    const weekKey = parseWeekKeyOrThrow(url.searchParams.get("weekKey"), new Date());

    const summary = await loadCityWeekSummary(selectedCity, weekKey);

    return ok(summary);
  } catch (error: unknown) {
    const err = error as ApiError;
    return fail(
      err.code || "SERVER_ERROR",
      err.message || "Could not load city-week analytics.",
      err.status || 500
    );
  }
}
