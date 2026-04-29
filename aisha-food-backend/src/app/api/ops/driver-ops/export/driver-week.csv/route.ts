import mongoose from "mongoose";
import { dbConnect } from "@/lib/mongodb";
import { fail } from "@/lib/apiResponse";
import { requireAdminKey } from "@/lib/adminAuth";
import { assertNotInMaintenance } from "@/lib/maintenance";
import { cityCode, requireActiveCity, resolveCityFromRequest } from "@/lib/city";
import { csvLine } from "@/lib/csv";
import { getWeekKey } from "@/lib/geo";
import { isValidWeekKey, normalizeRiderPayoutStatusFilter } from "@/lib/riderPayouts";
import { RiderPayout } from "@/models/RiderPayout";

type ApiError = Error & { status?: number; code?: string };

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

    const driverId = String(url.searchParams.get("driverId") || "").trim();
    if (!mongoose.Types.ObjectId.isValid(driverId)) {
      return fail("VALIDATION_ERROR", "Valid driverId is required.", 400);
    }

    const statusFilter = normalizeRiderPayoutStatusFilter(url.searchParams.get("status"), "all");
    const query: Record<string, unknown> = {
      cityId: new mongoose.Types.ObjectId(String(selectedCity._id)),
      weekKey,
      driverId: new mongoose.Types.ObjectId(driverId),
    };
    if (statusFilter === "pending" || statusFilter === "paid") {
      query.status = statusFilter;
    } else {
      query.status = { $in: ["pending", "paid"] };
    }

    const rows = await RiderPayout.find(query)
      .sort({ createdAt: -1, _id: -1 })
      .select(
        "_id orderId businessId driverId driverRef status amount deliveryFeeCharged platformMargin createdAt paidAt"
      )
      .lean<
        Array<{
          _id: mongoose.Types.ObjectId;
          orderId?: mongoose.Types.ObjectId | null;
          businessId?: mongoose.Types.ObjectId | null;
          driverId?: mongoose.Types.ObjectId | null;
          driverRef?: string | null;
          status?: string;
          amount?: number;
          deliveryFeeCharged?: number;
          platformMargin?: number;
          createdAt?: Date;
          paidAt?: Date | null;
        }>
      >();

    const lines: string[] = [];
    lines.push(
      csvLine([
        "weekKey",
        "cityCode",
        "payoutId",
        "orderId",
        "businessId",
        "driverId",
        "driverRef",
        "status",
        "amount",
        "deliveryFeeCharged",
        "platformMargin",
        "createdAt",
        "paidAt",
      ])
    );

    const selectedCityCode = cityCode(selectedCity) || "CITY";
    for (const row of rows) {
      lines.push(
        csvLine([
          weekKey,
          selectedCityCode,
          String(row._id),
          row.orderId ? String(row.orderId) : "",
          row.businessId ? String(row.businessId) : "",
          row.driverId ? String(row.driverId) : "",
          String(row.driverRef || ""),
          String(row.status || ""),
          Number(row.amount || 0),
          Number(row.deliveryFeeCharged || 0),
          Number(row.platformMargin || 0),
          row.createdAt ? new Date(row.createdAt).toISOString() : "",
          row.paidAt ? new Date(row.paidAt).toISOString() : "",
        ])
      );
    }

    const safeWeek = String(weekKey).replace(/[^A-Za-z0-9_-]/g, "");
    return new Response(lines.join("\n"), {
      status: 200,
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="ops-driver-payouts_driver_${driverId}_${safeWeek}.csv"`,
        "cache-control": "no-store",
      },
    });
  } catch (error: unknown) {
    const err = error as ApiError;
    return fail(
      err.code || "SERVER_ERROR",
      err.message || "Could not export driver/week payouts.",
      err.status || 500
    );
  }
}
