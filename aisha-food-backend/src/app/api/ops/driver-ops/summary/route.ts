import mongoose from "mongoose";
import { dbConnect } from "@/lib/mongodb";
import { ok, fail } from "@/lib/apiResponse";
import { requireAdminKey } from "@/lib/adminAuth";
import { assertNotInMaintenance } from "@/lib/maintenance";
import { cityCode, requireActiveCity, resolveCityFromRequest } from "@/lib/city";
import { getWeekKey } from "@/lib/geo";
import { isValidWeekKey } from "@/lib/riderPayouts";
import { RiderPayout } from "@/models/RiderPayout";

type ApiError = Error & { status?: number; code?: string };

function toNumber(value: unknown) {
  const num = Number(value || 0);
  return Number.isFinite(num) ? num : 0;
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
    const weekKeyInput = String(url.searchParams.get("weekKey") || "").trim();
    const weekKey = weekKeyInput || getWeekKey(new Date());
    if (!isValidWeekKey(weekKey)) {
      return fail("VALIDATION_ERROR", "Invalid weekKey format. Use YYYY-Www.", 400);
    }

    const cityObjectId = new mongoose.Types.ObjectId(String(selectedCity._id));
    const rows = await RiderPayout.aggregate<{
      _id: { driverId: mongoose.Types.ObjectId | null; driverRef: string | null };
      pendingCount: number;
      pendingAmount: number;
      paidCount: number;
      paidAmount: number;
      cashCollectedByRider: number;
      cashDueToRider: number;
      cashDueToPlatform: number;
    }>([
      {
        $match: {
          cityId: cityObjectId,
          weekKey,
          status: { $in: ["pending", "paid", "void"] },
        },
      },
      {
        $group: {
          _id: {
            driverId: "$driverId",
            driverRef: "$driverRef",
          },
          pendingCount: { $sum: { $cond: [{ $eq: ["$status", "pending"] }, 1, 0] } },
          pendingAmount: { $sum: { $cond: [{ $eq: ["$status", "pending"] }, "$amount", 0] } },
          paidCount: { $sum: { $cond: [{ $eq: ["$status", "paid"] }, 1, 0] } },
          paidAmount: { $sum: { $cond: [{ $eq: ["$status", "paid"] }, "$amount", 0] } },
          cashCollectedByRider: {
            $sum: { $cond: [{ $ne: ["$status", "void"] }, "$deliveryFeeCharged", 0] },
          },
          cashDueToRider: { $sum: { $cond: [{ $ne: ["$status", "void"] }, "$amount", 0] } },
          cashDueToPlatform: { $sum: { $cond: [{ $ne: ["$status", "void"] }, "$platformMargin", 0] } },
        },
      },
      {
        $sort: {
          pendingAmount: -1,
          paidAmount: -1,
          "_id.driverRef": 1,
        },
      },
    ]);

    let pendingCount = 0;
    let pendingAmount = 0;
    let paidCount = 0;
    let paidAmount = 0;

    const drivers = rows.map((row) => {
      const rowPendingCount = toNumber(row.pendingCount);
      const rowPendingAmount = toNumber(row.pendingAmount);
      const rowPaidCount = toNumber(row.paidCount);
      const rowPaidAmount = toNumber(row.paidAmount);
      const cashCollectedByRider = toNumber(row.cashCollectedByRider);
      const cashDueToRider = toNumber(row.cashDueToRider);
      const cashDueToPlatform = toNumber(row.cashDueToPlatform);

      pendingCount += rowPendingCount;
      pendingAmount += rowPendingAmount;
      paidCount += rowPaidCount;
      paidAmount += rowPaidAmount;

      return {
        driverId: row._id?.driverId ? String(row._id.driverId) : null,
        driverRef: String(row._id?.driverRef || ""),
        pendingCount: rowPendingCount,
        pendingAmount: rowPendingAmount,
        paidCount: rowPaidCount,
        paidAmount: rowPaidAmount,
        cash: {
          cashCollectedByRider,
          cashDueToRider,
          cashDueToPlatform,
          netSettlement: cashDueToRider - cashDueToPlatform,
        },
      };
    });

    return ok({
      cityId: String(selectedCity._id),
      cityCode: cityCode(selectedCity),
      weekKey,
      summary: {
        drivers: drivers.length,
        pendingCount,
        pendingAmount,
        paidCount,
        paidAmount,
      },
      drivers,
    });
  } catch (error: unknown) {
    const err = error as ApiError;
    return fail(
      err.code || "SERVER_ERROR",
      err.message || "Could not load driver ops summary.",
      err.status || 500
    );
  }
}
