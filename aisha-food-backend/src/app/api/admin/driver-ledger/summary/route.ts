import mongoose from "mongoose";
import { dbConnect } from "@/lib/mongodb";
import { ok, fail } from "@/lib/apiResponse";
import { requireAdminKey } from "@/lib/adminAuth";
import { assertNotInMaintenance } from "@/lib/maintenance";
import { getWeekKey } from "@/lib/geo";
import { getCityByIdOrDefault, cityCode, citySlug } from "@/lib/city";
import { RiderPayout } from "@/models/RiderPayout";
import { Driver } from "@/models/Driver";

type ApiError = Error & { status?: number; code?: string };

type DriverAgg = {
  _id: mongoose.Types.ObjectId | null;
  driverRef: string | null;
  pendingCount: number;
  pendingAmount: number;
  paidCountWeek: number;
  paidAmountWeek: number;
  cashCollectedByRider: number;
  cashDueToRider: number;
  cashDueToPlatform: number;
};

export async function GET(req: Request) {
  try {
    requireAdminKey(req);
    await assertNotInMaintenance();

    const url = new URL(req.url);
    const cityIdRaw = String(url.searchParams.get("cityId") || "").trim();
    const weekKeyRaw = String(url.searchParams.get("weekKey") || "").trim();
    const weekKey = weekKeyRaw || getWeekKey(new Date());

    if (cityIdRaw && !mongoose.Types.ObjectId.isValid(cityIdRaw)) {
      return fail("VALIDATION_ERROR", "Invalid cityId.", 400);
    }

    await dbConnect();
    const selectedCity = await getCityByIdOrDefault(cityIdRaw || null);
    const cityObjectId = new mongoose.Types.ObjectId(String(selectedCity._id));

    const rows = await RiderPayout.aggregate<DriverAgg>([
      {
        $match: {
          cityId: cityObjectId,
          weekKey,
        },
      },
      {
        $group: {
          _id: "$driverId",
          driverRef: { $max: "$driverRef" },
          pendingCount: {
            $sum: { $cond: [{ $eq: ["$status", "pending"] }, 1, 0] },
          },
          pendingAmount: {
            $sum: { $cond: [{ $eq: ["$status", "pending"] }, "$amount", 0] },
          },
          paidCountWeek: {
            $sum: { $cond: [{ $eq: ["$status", "paid"] }, 1, 0] },
          },
          paidAmountWeek: {
            $sum: { $cond: [{ $eq: ["$status", "paid"] }, "$amount", 0] },
          },
          cashCollectedByRider: {
            $sum: { $cond: [{ $ne: ["$status", "void"] }, "$deliveryFeeCharged", 0] },
          },
          cashDueToRider: {
            $sum: { $cond: [{ $ne: ["$status", "void"] }, "$amount", 0] },
          },
          cashDueToPlatform: {
            $sum: { $cond: [{ $ne: ["$status", "void"] }, "$platformMargin", 0] },
          },
        },
      },
      { $sort: { pendingAmount: -1, paidAmountWeek: -1 } },
    ]);

    const driverIds = rows
      .map((row) => row._id)
      .filter((id): id is mongoose.Types.ObjectId => Boolean(id))
      .map((id) => new mongoose.Types.ObjectId(String(id)));

    const drivers = driverIds.length
      ? await Driver.find({ _id: { $in: driverIds } })
          .select("_id name")
          .lean<Array<{ _id: mongoose.Types.ObjectId; name?: string }>>()
      : [];
    const driverMap = new Map(drivers.map((driver) => [String(driver._id), String(driver.name || "")]));

    return ok({
      city: {
        _id: String(selectedCity._id),
        code: cityCode(selectedCity),
        slug: citySlug(selectedCity),
        name: String(selectedCity.name || ""),
        isActive: Boolean(selectedCity.isActive),
      },
      weekKey,
      rows: rows.map((row) => {
        const driverId = row._id ? String(row._id) : "";
        const cashDueToRider = Number(row.cashDueToRider || 0);
        const cashDueToPlatform = Number(row.cashDueToPlatform || 0);
        return {
          driverId: driverId || null,
          driverName: driverId ? String(driverMap.get(driverId) || "") : "",
          driverRef: String(row.driverRef || ""),
          pendingCount: Number(row.pendingCount || 0),
          pendingAmount: Number(row.pendingAmount || 0),
          paidCountWeek: Number(row.paidCountWeek || 0),
          paidAmountWeek: Number(row.paidAmountWeek || 0),
          cashCollectedByRider: Number(row.cashCollectedByRider || 0),
          cashDueToRider,
          cashDueToPlatform,
          netSettlement: cashDueToRider - cashDueToPlatform,
        };
      }),
    });
  } catch (error: unknown) {
    const err = error as ApiError;
    return fail(
      err.code || "SERVER_ERROR",
      err.message || "Could not load driver ledger summary.",
      err.status || 500
    );
  }
}
