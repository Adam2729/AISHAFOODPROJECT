import mongoose from "mongoose";
import { dbConnect } from "@/lib/mongodb";
import { ok, fail } from "@/lib/apiResponse";
import { requireAdminKey } from "@/lib/adminAuth";
import { assertNotInMaintenance } from "@/lib/maintenance";
import { normalizeRiderPayoutStatusFilter } from "@/lib/riderPayouts";
import { RiderPayout } from "@/models/RiderPayout";
import { Order } from "@/models/Order";
import { Driver } from "@/models/Driver";
import { Business } from "@/models/Business";

type ApiError = Error & { status?: number; code?: string };

function parseIso(value: string | null): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export async function GET(req: Request) {
  try {
    requireAdminKey(req);
    await assertNotInMaintenance();

    const url = new URL(req.url);
    const status = normalizeRiderPayoutStatusFilter(url.searchParams.get("status"), "pending");
    const cityId = String(url.searchParams.get("cityId") || "").trim();
    const driverId = String(url.searchParams.get("driverId") || "").trim();
    const weekKey = String(url.searchParams.get("weekKey") || "").trim();
    const from = parseIso(url.searchParams.get("from"));
    const to = parseIso(url.searchParams.get("to"));
    const limitRaw = Number(url.searchParams.get("limit") || 200);
    const limit = Math.max(1, Math.min(1000, Math.floor(Number.isFinite(limitRaw) ? limitRaw : 200)));

    if (cityId && !mongoose.Types.ObjectId.isValid(cityId)) {
      return fail("VALIDATION_ERROR", "Invalid cityId.", 400);
    }
    if (driverId && !mongoose.Types.ObjectId.isValid(driverId)) {
      return fail("VALIDATION_ERROR", "Invalid driverId.", 400);
    }
    if ((url.searchParams.get("from") || "").trim() && !from) {
      return fail("VALIDATION_ERROR", "Invalid from date.", 400);
    }
    if ((url.searchParams.get("to") || "").trim() && !to) {
      return fail("VALIDATION_ERROR", "Invalid to date.", 400);
    }
    if (from && to && from > to) {
      return fail("VALIDATION_ERROR", "Invalid range: from must be <= to.", 400);
    }

    await dbConnect();
    const query: Record<string, unknown> = {};
    if (status !== "all") query.status = status;
    if (cityId) query.cityId = new mongoose.Types.ObjectId(cityId);
    if (driverId) query.driverId = new mongoose.Types.ObjectId(driverId);
    if (weekKey) query.weekKey = weekKey;
    if (from || to) {
      query.createdAt = {
        ...(from ? { $gte: from } : {}),
        ...(to ? { $lte: to } : {}),
      };
    }

    const rows = await RiderPayout.find(query)
      .sort({ createdAt: -1, _id: -1 })
      .limit(limit)
      .lean<
        Array<{
          _id: mongoose.Types.ObjectId;
          cityId: mongoose.Types.ObjectId;
          orderId: mongoose.Types.ObjectId;
          driverId?: mongoose.Types.ObjectId | null;
          driverRef?: string | null;
          businessId: mongoose.Types.ObjectId;
          weekKey: string;
          amount: number;
          deliveryFeeCharged: number;
          platformMargin: number;
          status: "pending" | "paid" | "void";
          paidAt?: Date | null;
          paidByAdminId?: string | null;
          note?: string | null;
          createdAt?: Date;
        }>
      >();

    const orderIds = rows.map((row) => row.orderId);
    const businessIds = rows.map((row) => row.businessId);
    const driverIds = rows
      .map((row) => row.driverId)
      .filter((id): id is mongoose.Types.ObjectId => Boolean(id));

    const [orders, businesses, drivers] = await Promise.all([
      Order.find({ _id: { $in: orderIds } })
        .select("_id orderNumber")
        .lean<Array<{ _id: mongoose.Types.ObjectId; orderNumber?: string }>>(),
      Business.find({ _id: { $in: businessIds } })
        .select("_id name")
        .lean<Array<{ _id: mongoose.Types.ObjectId; name?: string }>>(),
      Driver.find({ _id: { $in: driverIds } })
        .select("_id name")
        .lean<Array<{ _id: mongoose.Types.ObjectId; name?: string }>>(),
    ]);

    const orderMap = new Map(orders.map((row) => [String(row._id), row]));
    const businessMap = new Map(businesses.map((row) => [String(row._id), row]));
    const driverMap = new Map(drivers.map((row) => [String(row._id), row]));

    return ok({
      rows: rows.map((row) => ({
        id: String(row._id),
        cityId: String(row.cityId),
        orderId: String(row.orderId),
        orderNumber: String(orderMap.get(String(row.orderId))?.orderNumber || ""),
        driverId: row.driverId ? String(row.driverId) : null,
        driverName: row.driverId ? String(driverMap.get(String(row.driverId))?.name || "") : "",
        driverRef: String(row.driverRef || ""),
        businessId: String(row.businessId),
        businessName: String(businessMap.get(String(row.businessId))?.name || ""),
        weekKey: String(row.weekKey || ""),
        amount: Number(row.amount || 0),
        deliveryFeeCharged: Number(row.deliveryFeeCharged || 0),
        platformMargin: Number(row.platformMargin || 0),
        status: row.status,
        paidAt: row.paidAt || null,
        paidByAdminId: String(row.paidByAdminId || "").trim() || null,
        note: String(row.note || "").trim() || null,
        createdAt: row.createdAt || null,
      })),
    });
  } catch (error: unknown) {
    const err = error as ApiError;
    return fail(
      err.code || "SERVER_ERROR",
      err.message || "Could not load rider payouts.",
      err.status || 500
    );
  }
}
