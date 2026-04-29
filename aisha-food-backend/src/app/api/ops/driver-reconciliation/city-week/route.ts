import mongoose from "mongoose";
import { dbConnect } from "@/lib/mongodb";
import { ok, fail } from "@/lib/apiResponse";
import { requireAdminKey } from "@/lib/adminAuth";
import { assertNotInMaintenance } from "@/lib/maintenance";
import { cityCode, requireActiveCity, resolveCityFromRequest } from "@/lib/city";
import { getWeekKey } from "@/lib/geo";
import { RiderPayout } from "@/models/RiderPayout";

type ApiError = Error & { status?: number; code?: string };

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
    const weekKey = String(url.searchParams.get("weekKey") || "").trim() || getWeekKey(new Date());

    const cityId =
      cityIdParam && mongoose.Types.ObjectId.isValid(cityIdParam)
        ? new mongoose.Types.ObjectId(cityIdParam)
        : new mongoose.Types.ObjectId(String(resolvedCity._id));
    if (String(cityId) !== String(resolvedCity._id)) {
      return fail("CITY_MISMATCH", "cityId does not match selected city.", 403);
    }

    const rows = await RiderPayout.aggregate<{
      _id: mongoose.Types.ObjectId | null;
      pendingCount: number;
      pendingAmount: number;
      pendingMargin: number;
      paidCount: number;
      paidAmount: number;
      paidMargin: number;
    }>([
      {
        $match: {
          cityId,
          weekKey,
          status: { $in: ["pending", "paid"] },
        },
      },
      {
        $group: {
          _id: "$driverId",
          pendingCount: { $sum: { $cond: [{ $eq: ["$status", "pending"] }, 1, 0] } },
          pendingAmount: { $sum: { $cond: [{ $eq: ["$status", "pending"] }, "$amount", 0] } },
          pendingMargin: {
            $sum: { $cond: [{ $eq: ["$status", "pending"] }, "$platformMargin", 0] },
          },
          paidCount: { $sum: { $cond: [{ $eq: ["$status", "paid"] }, 1, 0] } },
          paidAmount: { $sum: { $cond: [{ $eq: ["$status", "paid"] }, "$amount", 0] } },
          paidMargin: {
            $sum: { $cond: [{ $eq: ["$status", "paid"] }, "$platformMargin", 0] },
          },
        },
      },
    ]);

    const drivers = rows
      .map((row) => {
        const pendingNet = asNumber(row.pendingAmount) - asNumber(row.pendingMargin);
        const paidNet = asNumber(row.paidAmount) - asNumber(row.paidMargin);
        const totalNet = pendingNet + paidNet;
        return {
          driverId: row._id ? String(row._id) : null,
          pendingCount: asNumber(row.pendingCount),
          pendingNetSettlement: pendingNet,
          paidCount: asNumber(row.paidCount),
          paidNetSettlement: paidNet,
          totalNetSettlement: totalNet,
        };
      })
      .sort((a, b) => Math.abs(b.totalNetSettlement) - Math.abs(a.totalNetSettlement))
      .slice(0, 200);

    return ok({
      cityId: String(cityId),
      cityCode: cityCode(resolvedCity),
      weekKey,
      drivers,
    });
  } catch (error: unknown) {
    const err = error as ApiError;
    return fail(
      err.code || "SERVER_ERROR",
      err.message || "Could not load driver reconciliation city/week.",
      err.status || 500
    );
  }
}

