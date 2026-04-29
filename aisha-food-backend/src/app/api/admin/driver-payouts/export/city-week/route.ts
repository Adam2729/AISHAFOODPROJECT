import mongoose from "mongoose";
import { dbConnect } from "@/lib/mongodb";
import { fail } from "@/lib/apiResponse";
import { requireAdminKey } from "@/lib/adminAuth";
import { assertNotInMaintenance } from "@/lib/maintenance";
import { csvLine } from "@/lib/csv";
import { cityCode, citySlug, requireActiveCity } from "@/lib/city";
import { RiderPayout } from "@/models/RiderPayout";
import { City } from "@/models/City";

type ApiError = Error & { status?: number; code?: string };

type ExportStatus = "pending" | "paid" | "all";

function normalizeStatus(value: unknown): ExportStatus {
  const status = String(value || "").trim().toLowerCase();
  if (status === "pending" || status === "paid") return status;
  return "all";
}

export async function GET(req: Request) {
  try {
    requireAdminKey(req);
    await assertNotInMaintenance();
    await dbConnect();

    const url = new URL(req.url);
    const cityId = String(url.searchParams.get("cityId") || "").trim();
    const weekKey = String(url.searchParams.get("weekKey") || "").trim();
    const status = normalizeStatus(url.searchParams.get("status"));

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

    const query: Record<string, unknown> = { cityId: cityObjectId, weekKey };
    if (status !== "all") query.status = status;

    const rows = await RiderPayout.find(query)
      .sort({ createdAt: -1, _id: -1 })
      .select(
        "_id cityId weekKey driverId driverRef orderId status amount deliveryFeeCharged platformMargin createdAt paidAt"
      )
      .lean<
        Array<{
          _id: mongoose.Types.ObjectId;
          cityId?: mongoose.Types.ObjectId;
          weekKey?: string;
          driverId?: mongoose.Types.ObjectId | null;
          driverRef?: string | null;
          orderId?: mongoose.Types.ObjectId | null;
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
        "cityId",
        "driverId",
        "driverRef",
        "payoutId",
        "orderId",
        "status",
        "amount",
        "deliveryFeeCharged",
        "platformMargin",
        "createdAt",
        "paidAt",
      ])
    );

    for (const row of rows) {
      lines.push(
        csvLine([
          String(row.weekKey || weekKey),
          String(row.cityId || cityId),
          row.driverId ? String(row.driverId) : "",
          String(row.driverRef || ""),
          String(row._id),
          row.orderId ? String(row.orderId) : "",
          String(row.status || ""),
          Number(row.amount || 0),
          Number(row.deliveryFeeCharged || 0),
          Number(row.platformMargin || 0),
          row.createdAt ? new Date(row.createdAt).toISOString() : "",
          row.paidAt ? new Date(row.paidAt).toISOString() : "",
        ])
      );
    }

    const safeCity = citySlug({ slug: String(city.slug || ""), name: String(city.name || "") }) || cityCode(city) || "city";
    const safeWeek = String(weekKey).replace(/[^A-Za-z0-9_-]/g, "");
    const safeStatus = status;
    return new Response(lines.join("\n"), {
      status: 200,
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="rider-payouts_${safeCity}_${safeWeek}_${safeStatus}.csv"`,
        "cache-control": "no-store",
      },
    });
  } catch (error: unknown) {
    const err = error as ApiError;
    return fail(
      err.code || "SERVER_ERROR",
      err.message || "Could not export city/week rider payouts.",
      err.status || 500
    );
  }
}

