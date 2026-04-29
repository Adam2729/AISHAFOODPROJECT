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
      deliveredCount: number;
      assignedCount: number;
      unassignedCount: number;
      otpVerifiedDeliveredCount: number;
      avgTimeToAcceptMin: number | null;
      avgTimeToDeliverMin: number | null;
      status_new: number;
      status_accepted: number;
      status_preparing: number;
      status_out_for_delivery: number;
      status_delivered: number;
      status_cancelled: number;
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
          deliveredCount: { $sum: { $cond: [{ $eq: ["$status", "delivered"] }, 1, 0] } },
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
          avgTimeToAcceptMin: {
            $avg: {
              $cond: [
                {
                  $and: [
                    { $ne: ["$statusTimestamps.acceptedAt", null] },
                    { $ne: ["$createdAt", null] },
                  ],
                },
                {
                  $divide: [{ $subtract: ["$statusTimestamps.acceptedAt", "$createdAt"] }, 60000],
                },
                null,
              ],
            },
          },
          avgTimeToDeliverMin: {
            $avg: {
              $cond: [
                {
                  $and: [{ $eq: ["$status", "delivered"] }, { $ne: ["$sla.deliveredAt", null] }],
                },
                { $divide: [{ $subtract: ["$sla.deliveredAt", "$createdAt"] }, 60000] },
                null,
              ],
            },
          },
          status_new: { $sum: { $cond: [{ $eq: ["$status", "new"] }, 1, 0] } },
          status_accepted: { $sum: { $cond: [{ $eq: ["$status", "accepted"] }, 1, 0] } },
          status_preparing: { $sum: { $cond: [{ $eq: ["$status", "preparing"] }, 1, 0] } },
          status_out_for_delivery: {
            $sum: { $cond: [{ $eq: ["$status", "out_for_delivery"] }, 1, 0] },
          },
          status_delivered: { $sum: { $cond: [{ $eq: ["$status", "delivered"] }, 1, 0] } },
          status_cancelled: { $sum: { $cond: [{ $eq: ["$status", "cancelled"] }, 1, 0] } },
        },
      },
    ]);

    return ok({
      cityId: String(selectedCity._id),
      cityCode: cityCode(selectedCity),
      weekKey: range.weekKey,
      range: {
        fromIso: range.fromIso,
        toIso: range.toIso,
        mode: range.mode,
      },
      dispatch: {
        deliveredCount: toNumber(agg?.deliveredCount),
        assignedCount: toNumber(agg?.assignedCount),
        unassignedCount: toNumber(agg?.unassignedCount),
        otpVerifiedDeliveredCount: toNumber(agg?.otpVerifiedDeliveredCount),
        avgTimeToAcceptMin: toAverage(agg?.avgTimeToAcceptMin),
        avgTimeToDeliverMin: toAverage(agg?.avgTimeToDeliverMin),
      },
      breakdownByStatus: {
        new: toNumber(agg?.status_new),
        accepted: toNumber(agg?.status_accepted),
        preparing: toNumber(agg?.status_preparing),
        out_for_delivery: toNumber(agg?.status_out_for_delivery),
        delivered: toNumber(agg?.status_delivered),
        cancelled: toNumber(agg?.status_cancelled),
      },
    });
  } catch (error: unknown) {
    const err = error as ApiError;
    return fail(
      err.code || "SERVER_ERROR",
      err.message || "Could not load city dispatch analytics.",
      err.status || 500
    );
  }
}
