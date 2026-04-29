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
type StatusFilter = "pending" | "paid" | "all";

type PayoutLean = {
  _id: mongoose.Types.ObjectId;
  orderId?: mongoose.Types.ObjectId | null;
  businessId?: mongoose.Types.ObjectId | null;
  amount?: number;
  deliveryFeeCharged?: number;
  platformMargin?: number;
  status?: "pending" | "paid" | "void";
  createdAt?: Date;
  paidAt?: Date | null;
  driverRef?: string | null;
};

function toNumber(value: unknown) {
  const num = Number(value || 0);
  return Number.isFinite(num) ? num : 0;
}

function normalizeStatus(value: unknown): StatusFilter {
  const raw = String(value || "").trim().toLowerCase();
  if (raw === "pending" || raw === "paid") return raw;
  return "all";
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

    const driverId = String(url.searchParams.get("driverId") || "").trim();
    if (!mongoose.Types.ObjectId.isValid(driverId)) {
      return fail("VALIDATION_ERROR", "Valid driverId is required.", 400);
    }

    const pageRaw = Number(url.searchParams.get("page") || "1");
    const pageSizeRaw = Number(url.searchParams.get("pageSize") || "50");
    const page = Number.isFinite(pageRaw) && pageRaw > 0 ? Math.floor(pageRaw) : 1;
    const pageSize = Number.isFinite(pageSizeRaw)
      ? Math.min(200, Math.max(1, Math.floor(pageSizeRaw)))
      : 50;
    const status = normalizeStatus(url.searchParams.get("status"));

    const cityObjectId = new mongoose.Types.ObjectId(String(selectedCity._id));
    const driverObjectId = new mongoose.Types.ObjectId(driverId);
    const baseQuery: Record<string, unknown> = {
      cityId: cityObjectId,
      weekKey,
      driverId: driverObjectId,
    };

    const totalsRows = await RiderPayout.find(baseQuery)
      .select("amount deliveryFeeCharged platformMargin status")
      .lean<
        Array<{
          amount?: number;
          deliveryFeeCharged?: number;
          platformMargin?: number;
          status?: "pending" | "paid" | "void";
        }>
      >();

    let pendingCount = 0;
    let pendingAmount = 0;
    let paidCount = 0;
    let paidAmount = 0;
    let cashCollectedByRider = 0;
    let cashDueToRider = 0;
    let cashDueToPlatform = 0;

    for (const row of totalsRows) {
      const amount = toNumber(row.amount);
      const deliveryFeeCharged = toNumber(row.deliveryFeeCharged);
      const platformMargin = toNumber(row.platformMargin);
      const rowStatus = String(row.status || "");

      if (rowStatus === "pending") {
        pendingCount += 1;
        pendingAmount += amount;
      }
      if (rowStatus === "paid") {
        paidCount += 1;
        paidAmount += amount;
      }
      if (rowStatus !== "void") {
        cashCollectedByRider += deliveryFeeCharged;
        cashDueToRider += amount;
        cashDueToPlatform += platformMargin;
      }
    }

    const rowsQuery: Record<string, unknown> = { ...baseQuery };
    if (status === "pending" || status === "paid") {
      rowsQuery.status = status;
    } else {
      rowsQuery.status = { $ne: "void" };
    }

    const sort: Record<string, 1 | -1> =
      status === "paid"
        ? { paidAt: -1, _id: -1 }
        : { createdAt: 1, _id: 1 };

    const skip = (page - 1) * pageSize;
    const [rows, totalRowsCount] = await Promise.all([
      RiderPayout.find(rowsQuery)
        .sort(sort)
        .skip(skip)
        .limit(pageSize)
        .select(
          "_id orderId businessId amount deliveryFeeCharged platformMargin status createdAt paidAt driverRef"
        )
        .lean<PayoutLean[]>(),
      RiderPayout.countDocuments(rowsQuery),
    ]);

    const hasMore = skip + rows.length < Number(totalRowsCount || 0);
    const driverRef =
      String(rows[0]?.driverRef || "") ||
      String((await RiderPayout.findOne(baseQuery).select("driverRef").lean<{ driverRef?: string | null } | null>())?.driverRef || "");

    return ok({
      cityId: String(selectedCity._id),
      cityCode: cityCode(selectedCity),
      weekKey,
      driverId,
      driverRef,
      totals: {
        pendingCount,
        pendingAmount,
        paidCount,
        paidAmount,
      },
      cash: {
        cashCollectedByRider,
        cashDueToRider,
        cashDueToPlatform,
        netSettlement: cashDueToRider - cashDueToPlatform,
      },
      rows: rows.map((row) => ({
        payoutId: String(row._id),
        orderId: row.orderId ? String(row.orderId) : "",
        businessId: row.businessId ? String(row.businessId) : "",
        amount: toNumber(row.amount),
        deliveryFeeCharged: toNumber(row.deliveryFeeCharged),
        platformMargin: toNumber(row.platformMargin),
        status: String(row.status || ""),
        createdAt: row.createdAt || null,
        paidAt: row.paidAt || null,
        driverRef: String(row.driverRef || ""),
      })),
      status,
      page,
      pageSize,
      hasMore,
    });
  } catch (error: unknown) {
    const err = error as ApiError;
    return fail(
      err.code || "SERVER_ERROR",
      err.message || "Could not load driver ops detail.",
      err.status || 500
    );
  }
}
