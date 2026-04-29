import mongoose from "mongoose";
import { dbConnect } from "@/lib/mongodb";
import { fail } from "@/lib/apiResponse";
import { requireAdminKey } from "@/lib/adminAuth";
import { assertNotInMaintenance } from "@/lib/maintenance";
import { cityCode, requireActiveCity, resolveCityFromRequest } from "@/lib/city";
import { csvLine } from "@/lib/csv";
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
      .select(
        "_id orderId driverId amount deliveryFeeCharged platformMargin weekKey createdAt"
      )
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

    const lines: string[] = [];
    lines.push(
      csvLine([
        "payoutId",
        "orderId",
        "driverId",
        "amount",
        "deliveryFeeCharged",
        "platformMargin",
        "weekKey",
        "createdAt",
      ])
    );
    for (const row of rows) {
      lines.push(
        csvLine([
          String(row._id),
          row.orderId ? String(row.orderId) : "",
          row.driverId ? String(row.driverId) : "",
          Number(row.amount || 0),
          Number(row.deliveryFeeCharged || 0),
          Number(row.platformMargin || 0),
          String(row.weekKey || ""),
          row.createdAt ? new Date(row.createdAt).toISOString() : "",
        ])
      );
    }

    const safeWeek = String(weekKey).replace(/[^A-Za-z0-9_-]/g, "");
    const filename = `pending-payouts_${cityCode(resolvedCity) || "CITY"}_${safeWeek}.csv`;
    return new Response(lines.join("\n"), {
      status: 200,
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="${filename}"`,
        "cache-control": "no-store",
      },
    });
  } catch (error: unknown) {
    const err = error as ApiError;
    return fail(
      err.code || "SERVER_ERROR",
      err.message || "Could not export pending payouts.",
      err.status || 500
    );
  }
}

