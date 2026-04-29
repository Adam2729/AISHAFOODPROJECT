import mongoose from "mongoose";
import { dbConnect } from "@/lib/mongodb";
import { ok, fail } from "@/lib/apiResponse";
import { requireAdminKey } from "@/lib/adminAuth";
import { assertNotInMaintenance } from "@/lib/maintenance";
import { requireActiveCity } from "@/lib/city";
import { RiderPayout } from "@/models/RiderPayout";
import { City } from "@/models/City";

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

    const url = new URL(req.url);
    const cityId = String(url.searchParams.get("cityId") || "").trim();
    const weekKey = String(url.searchParams.get("weekKey") || "").trim();

    if (!mongoose.Types.ObjectId.isValid(cityId)) {
      return fail("VALIDATION_ERROR", "Valid cityId is required.", 400);
    }
    if (!weekKey) {
      return fail("VALIDATION_ERROR", "weekKey is required.", 400);
    }

    const cityObjectId = new mongoose.Types.ObjectId(cityId);
    const city = await City.findById(cityObjectId)
      .select("_id code slug name country isActive")
      .lean<{
        _id: mongoose.Types.ObjectId;
        code?: string;
        slug?: string;
        name?: string;
        country?: string;
        isActive?: boolean;
      } | null>();
    if (!city) {
      return fail("NOT_FOUND", "City not found.", 404);
    }
    requireActiveCity({
      isActive: Boolean(city.isActive),
      code: String(city.code || ""),
      name: String(city.name || ""),
      country: String(city.country || ""),
    });

    const driverRows = await RiderPayout.aggregate<{
      _id: { driverId: mongoose.Types.ObjectId | null; driverRef: string | null };
      pendingCount: number;
      pendingAmount: number;
      paidCount: number;
      paidAmount: number;
      cashCollected: number;
      platformMargin: number;
      cashDueToRider: number;
    }>([
      { $match: { cityId: cityObjectId, weekKey } },
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
          cashCollected: { $sum: { $cond: [{ $ne: ["$status", "void"] }, "$deliveryFeeCharged", 0] } },
          platformMargin: { $sum: { $cond: [{ $ne: ["$status", "void"] }, "$platformMargin", 0] } },
          cashDueToRider: { $sum: { $cond: [{ $ne: ["$status", "void"] }, "$amount", 0] } },
        },
      },
      {
        $sort: {
          pendingAmount: -1,
          pendingCount: -1,
          "_id.driverRef": 1,
        },
      },
    ]);

    let pendingCount = 0;
    let pendingAmount = 0;
    let paidCount = 0;
    let paidAmount = 0;
    let cashCollectedByRiders = 0;
    let platformMarginTotal = 0;
    let cashDueToRiders = 0;

    const drivers = driverRows.map((row) => {
      const rowPendingCount = toNumber(row.pendingCount);
      const rowPendingAmount = toNumber(row.pendingAmount);
      const rowPaidCount = toNumber(row.paidCount);
      const rowPaidAmount = toNumber(row.paidAmount);
      const rowCashCollected = toNumber(row.cashCollected);
      const rowPlatformMargin = toNumber(row.platformMargin);
      const rowCashDueToRider = toNumber(row.cashDueToRider);
      const rowNetSettlement = rowCashDueToRider - rowPlatformMargin;

      pendingCount += rowPendingCount;
      pendingAmount += rowPendingAmount;
      paidCount += rowPaidCount;
      paidAmount += rowPaidAmount;
      cashCollectedByRiders += rowCashCollected;
      platformMarginTotal += rowPlatformMargin;
      cashDueToRiders += rowCashDueToRider;

      return {
        driverId: row._id?.driverId ? String(row._id.driverId) : null,
        driverRef: String(row._id?.driverRef || ""),
        pendingCount: rowPendingCount,
        pendingAmount: rowPendingAmount,
        paidCount: rowPaidCount,
        paidAmount: rowPaidAmount,
        cashCollected: rowCashCollected,
        platformMargin: rowPlatformMargin,
        cashDueToRider: rowCashDueToRider,
        netSettlement: rowNetSettlement,
      };
    });

    return ok({
      cityId,
      weekKey,
      totals: {
        pendingCount,
        pendingAmount,
        paidCount,
        paidAmount,
        cashCollectedByRiders,
        platformMarginTotal,
        cashDueToRiders,
        netSettlementTotal: cashDueToRiders - platformMarginTotal,
      },
      drivers,
    });
  } catch (error: unknown) {
    const err = error as ApiError;
    return fail(
      err.code || "SERVER_ERROR",
      err.message || "Could not load driver payouts summary.",
      err.status || 500
    );
  }
}
