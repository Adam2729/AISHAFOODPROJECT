import mongoose from "mongoose";
import { dbConnect } from "@/lib/mongodb";
import { ok, fail } from "@/lib/apiResponse";
import { requireAdminKey } from "@/lib/adminAuth";
import { assertNotInMaintenance } from "@/lib/maintenance";
import { cityCode, requireActiveCity, resolveCityFromRequest } from "@/lib/city";
import { getWeekKey } from "@/lib/geo";
import { RiderPayout } from "@/models/RiderPayout";

type ApiError = Error & { status?: number; code?: string };

type Totals = {
  count: number;
  cashCollectedByRider: number;
  cashDueToRider: number;
  cashDueToPlatform: number;
  netSettlement: number;
};

function emptyTotals(): Totals {
  return {
    count: 0,
    cashCollectedByRider: 0,
    cashDueToRider: 0,
    cashDueToPlatform: 0,
    netSettlement: 0,
  };
}

function asNumber(value: unknown) {
  const num = Number(value || 0);
  return Number.isFinite(num) ? num : 0;
}

export async function GET(req: Request) {
  try {
    requireAdminKey(req);
    await assertNotInMaintenance();
    await dbConnect();

    const url = new URL(req.url);
    const resolvedCity = await resolveCityFromRequest(req);
    requireActiveCity({
      isActive: Boolean(resolvedCity.isActive),
      code: String(resolvedCity.code || ""),
      name: String(resolvedCity.name || ""),
      country: String(resolvedCity.country || ""),
    });

    const cityIdParam = String(url.searchParams.get("cityId") || "").trim();
    const driverIdRaw = String(url.searchParams.get("driverId") || "").trim();
    const weekKey = String(url.searchParams.get("weekKey") || "").trim() || getWeekKey(new Date());

    if (!driverIdRaw || !mongoose.Types.ObjectId.isValid(driverIdRaw)) {
      return fail("VALIDATION_ERROR", "Valid driverId is required.", 400);
    }
    const driverId = new mongoose.Types.ObjectId(driverIdRaw);
    const cityId =
      cityIdParam && mongoose.Types.ObjectId.isValid(cityIdParam)
        ? new mongoose.Types.ObjectId(cityIdParam)
        : new mongoose.Types.ObjectId(String(resolvedCity._id));
    if (String(cityId) !== String(resolvedCity._id)) {
      return fail("CITY_MISMATCH", "cityId does not match selected city.", 403);
    }

    const match = {
      cityId,
      weekKey,
      driverId,
      status: { $in: ["pending", "paid"] },
    };

    const agg = await RiderPayout.aggregate<{
      _id: string;
      count: number;
      deliveryFeeCharged: number;
      amount: number;
      platformMargin: number;
    }>([
      { $match: match },
      {
        $group: {
          _id: "$status",
          count: { $sum: 1 },
          deliveryFeeCharged: { $sum: "$deliveryFeeCharged" },
          amount: { $sum: "$amount" },
          platformMargin: { $sum: "$platformMargin" },
        },
      },
    ]);

    const totalsByStatus: Record<string, Totals> = {
      pending: emptyTotals(),
      paid: emptyTotals(),
      all: emptyTotals(),
    };

    for (const row of agg) {
      const key = row._id === "paid" ? "paid" : "pending";
      const target = totalsByStatus[key];
      target.count = asNumber(row.count);
      target.cashCollectedByRider = asNumber(row.deliveryFeeCharged);
      target.cashDueToRider = asNumber(row.amount);
      target.cashDueToPlatform = asNumber(row.platformMargin);
      target.netSettlement = target.cashDueToRider - target.cashDueToPlatform;
    }

    totalsByStatus.all = {
      count: totalsByStatus.pending.count + totalsByStatus.paid.count,
      cashCollectedByRider:
        totalsByStatus.pending.cashCollectedByRider + totalsByStatus.paid.cashCollectedByRider,
      cashDueToRider:
        totalsByStatus.pending.cashDueToRider + totalsByStatus.paid.cashDueToRider,
      cashDueToPlatform:
        totalsByStatus.pending.cashDueToPlatform + totalsByStatus.paid.cashDueToPlatform,
      netSettlement:
        totalsByStatus.pending.netSettlement + totalsByStatus.paid.netSettlement,
    };

    const rowsPreview = await RiderPayout.find(match)
      .sort({ createdAt: -1, _id: -1 })
      .limit(50)
      .select(
        "_id orderId status amount deliveryFeeCharged platformMargin weekKey createdAt paidAt"
      )
      .lean<
        Array<{
          _id: mongoose.Types.ObjectId;
          orderId?: mongoose.Types.ObjectId | null;
          status?: string;
          amount?: number;
          deliveryFeeCharged?: number;
          platformMargin?: number;
          weekKey?: string;
          createdAt?: Date;
          paidAt?: Date | null;
        }>
      >();

    return ok({
      cityId: String(cityId),
      cityCode: cityCode(resolvedCity),
      weekKey,
      driverId: String(driverId),
      totals: totalsByStatus,
      rowsPreview: rowsPreview.map((row) => ({
        payoutId: String(row._id),
        orderId: row.orderId ? String(row.orderId) : "",
        status: String(row.status || ""),
        amount: asNumber(row.amount),
        deliveryFeeCharged: asNumber(row.deliveryFeeCharged),
        platformMargin: asNumber(row.platformMargin),
        createdAt: row.createdAt || null,
        paidAt: row.paidAt || null,
      })),
    });
  } catch (error: unknown) {
    const err = error as ApiError;
    return fail(
      err.code || "SERVER_ERROR",
      err.message || "Could not load driver reconciliation.",
      err.status || 500
    );
  }
}

