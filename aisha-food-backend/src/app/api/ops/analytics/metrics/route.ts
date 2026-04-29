import mongoose from "mongoose";
import { dbConnect } from "@/lib/mongodb";
import { ok, fail } from "@/lib/apiResponse";
import { requireAdminKey } from "@/lib/adminAuth";
import { assertNotInMaintenance } from "@/lib/maintenance";
import { cityCode, requireActiveCity, resolveCityFromRequest } from "@/lib/city";
import { buildOrderRangeMatch, resolveRangeFromQuery } from "@/lib/opsAnalytics";
import { Order } from "@/models/Order";

type ApiError = Error & { status?: number; code?: string };

function toNumber(value: unknown) {
  const num = Number(value || 0);
  return Number.isFinite(num) ? num : 0;
}

function toAverage(value: unknown) {
  const num = Number(value);
  if (!Number.isFinite(num)) return null;
  return Number(num.toFixed(2));
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
    const range = resolveRangeFromQuery(url);
    const cityObjectId = new mongoose.Types.ObjectId(String(selectedCity._id));

    const [agg] = await Order.aggregate<{
      ordersTotal: number;
      ordersDelivered: number;
      ordersCancelled: number;
      ordersNew: number;
      uniqueBusinesses: mongoose.Types.ObjectId[];
      uniqueCustomers: string[];
      avgSubtotal: number;
      avgDeliveryFee: number;
      avgTotal: number;
      otpVerifiedDeliveredCount: number;
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
          ordersDelivered: { $sum: { $cond: [{ $eq: ["$status", "delivered"] }, 1, 0] } },
          ordersCancelled: { $sum: { $cond: [{ $eq: ["$status", "cancelled"] }, 1, 0] } },
          ordersNew: { $sum: { $cond: [{ $eq: ["$status", "new"] }, 1, 0] } },
          uniqueBusinesses: { $addToSet: "$businessId" },
          uniqueCustomers: {
            $addToSet: {
              $cond: [
                {
                  $and: [
                    { $ne: ["$phoneHash", null] },
                    { $ne: [{ $trim: { input: { $ifNull: ["$phoneHash", ""] } } }, ""] },
                  ],
                },
                "$phoneHash",
                "$$REMOVE",
              ],
            },
          },
          avgSubtotal: { $avg: "$subtotal" },
          avgDeliveryFee: { $avg: "$deliveryFeeToCustomer" },
          avgTotal: { $avg: "$total" },
          otpVerifiedDeliveredCount: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $eq: ["$status", "delivered"] },
                    { $ne: ["$deliveryProof.verifiedAt", null] },
                  ],
                },
                1,
                0,
              ],
            },
          },
        },
      },
    ]);

    const metrics = {
      ordersTotal: toNumber(agg?.ordersTotal),
      ordersDelivered: toNumber(agg?.ordersDelivered),
      ordersCancelled: toNumber(agg?.ordersCancelled),
      ordersNew: toNumber(agg?.ordersNew),
      uniqueBusinesses: Array.isArray(agg?.uniqueBusinesses) ? agg.uniqueBusinesses.length : 0,
      uniqueCustomers: Array.isArray(agg?.uniqueCustomers) ? agg.uniqueCustomers.length : 0,
      avgSubtotal: toAverage(agg?.avgSubtotal),
      avgDeliveryFee: toAverage(agg?.avgDeliveryFee),
      avgTotal: toAverage(agg?.avgTotal),
      otpVerifiedDeliveredCount: toNumber(agg?.otpVerifiedDeliveredCount),
    };

    return ok({
      cityId: String(selectedCity._id),
      cityCode: cityCode(selectedCity),
      weekKey: range.weekKey,
      range: {
        fromIso: range.fromIso,
        toIso: range.toIso,
        mode: range.mode,
      },
      metrics,
    });
  } catch (error: unknown) {
    const err = error as ApiError;
    return fail(
      err.code || "SERVER_ERROR",
      err.message || "Could not load city metrics analytics.",
      err.status || 500
    );
  }
}
