import mongoose from "mongoose";
import { dbConnect } from "@/lib/mongodb";
import { ok, fail } from "@/lib/apiResponse";
import { requireAdminKey } from "@/lib/adminAuth";
import { assertNotInMaintenance } from "@/lib/maintenance";
import { requireActiveCity, resolveCityFromRequest } from "@/lib/city";
import { getWeekKey } from "@/lib/geo";
import { RiderPayout } from "@/models/RiderPayout";

type ApiError = Error & { status?: number; code?: string };

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

    const rows = await RiderPayout.find({
      cityId,
      weekKey,
      status: "pending",
    })
      .sort({ createdAt: 1, _id: 1 })
      .limit(1000)
      .select("_id orderId driverId amount deliveryFeeCharged platformMargin weekKey createdAt")
      .lean<
        Array<{
          _id: mongoose.Types.ObjectId;
          orderId?: mongoose.Types.ObjectId | null;
          driverId?: mongoose.Types.ObjectId | null;
          amount?: number;
          deliveryFeeCharged?: number;
          platformMargin?: number;
          weekKey?: string;
          createdAt?: Date;
        }>
      >();

    return ok({
      cityId: String(cityId),
      weekKey,
      pending: rows.map((row) => ({
        payoutId: String(row._id),
        orderId: row.orderId ? String(row.orderId) : "",
        driverId: row.driverId ? String(row.driverId) : "",
        amount: Number(row.amount || 0),
        deliveryFeeCharged: Number(row.deliveryFeeCharged || 0),
        platformMargin: Number(row.platformMargin || 0),
        weekKey: String(row.weekKey || ""),
        createdAt: row.createdAt || null,
      })),
    });
  } catch (error: unknown) {
    const err = error as ApiError;
    return fail(
      err.code || "SERVER_ERROR",
      err.message || "Could not load pending payouts.",
      err.status || 500
    );
  }
}

