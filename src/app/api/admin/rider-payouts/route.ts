import mongoose from "mongoose";
import { dbConnect } from "@/lib/mongodb";
import { ok, fail } from "@/lib/apiResponse";
import { requireAdminKey } from "@/lib/adminAuth";
import { RiderPayout } from "@/models/RiderPayout";
import { Order } from "@/models/Order";
import { Driver } from "@/models/Driver";
import { Business } from "@/models/Business";

type ApiError = Error & { status?: number; code?: string };

type RiderPayoutStatus = "pending" | "paid" | "void";

function normalizeStatus(value: string): RiderPayoutStatus | "" {
  const status = String(value || "").trim().toLowerCase();
  if (status === "pending" || status === "paid" || status === "void") return status;
  return "";
}

export async function GET(req: Request) {
  try {
    requireAdminKey(req);
    const url = new URL(req.url);
    const status = normalizeStatus(String(url.searchParams.get("status") || "pending"));
    const cityId = String(url.searchParams.get("cityId") || "").trim();
    const limitRaw = Number(url.searchParams.get("limit") || 200);
    const limit = Math.max(1, Math.min(500, Math.floor(Number.isFinite(limitRaw) ? limitRaw : 200)));

    if (!status) {
      return fail("VALIDATION_ERROR", "Invalid status.", 400);
    }
    if (cityId && !mongoose.Types.ObjectId.isValid(cityId)) {
      return fail("VALIDATION_ERROR", "Invalid cityId.", 400);
    }

    await dbConnect();
    const query: Record<string, unknown> = { status };
    if (cityId) query.cityId = new mongoose.Types.ObjectId(cityId);

    const rows = await RiderPayout.find(query)
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean<
        Array<{
          _id: mongoose.Types.ObjectId;
          cityId: mongoose.Types.ObjectId;
          orderId: mongoose.Types.ObjectId;
          driverId?: mongoose.Types.ObjectId | null;
          businessId: mongoose.Types.ObjectId;
          weekKey: string;
          amount: number;
          deliveryFeeCharged: number;
          platformMargin: number;
          status: RiderPayoutStatus;
          paidAt?: Date | null;
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
        driverName: row.driverId ? String(driverMap.get(String(row.driverId))?.name || "") : null,
        businessId: String(row.businessId),
        businessName: String(businessMap.get(String(row.businessId))?.name || ""),
        weekKey: String(row.weekKey || ""),
        amount: Number(row.amount || 0),
        deliveryFeeCharged: Number(row.deliveryFeeCharged || 0),
        platformMargin: Number(row.platformMargin || 0),
        status: row.status,
        paidAt: row.paidAt || null,
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

