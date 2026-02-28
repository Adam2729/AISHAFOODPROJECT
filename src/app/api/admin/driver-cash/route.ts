import mongoose from "mongoose";
import { dbConnect } from "@/lib/mongodb";
import { ok, fail } from "@/lib/apiResponse";
import { requireAdminKey } from "@/lib/adminAuth";
import { getWeekKey } from "@/lib/geo";
import { roundCurrency } from "@/lib/money";
import { Business } from "@/models/Business";
import { Driver } from "@/models/Driver";
import { DriverCashHandoff } from "@/models/DriverCashHandoff";
import { Order } from "@/models/Order";

type ApiError = Error & { status?: number; code?: string };

type DriverCashStatus = "collected" | "handed_to_merchant" | "disputed" | "void";

type HandoffLean = {
  _id: mongoose.Types.ObjectId;
  orderId: mongoose.Types.ObjectId;
  businessId: mongoose.Types.ObjectId;
  driverId: mongoose.Types.ObjectId;
  weekKey: string;
  amountCollectedRdp: number;
  collectedAt: Date;
  handedToMerchantAt?: Date | null;
  receiptRef?: string | null;
  proofUrl?: string | null;
  status: DriverCashStatus;
  dispute?: {
    openedAt?: Date | null;
    openedBy?: "merchant" | "admin" | null;
    reason?: string | null;
    resolvedAt?: Date | null;
    resolution?: "merchant_confirmed" | "driver_confirmed" | "writeoff" | null;
  } | null;
};

function normalizeStatus(value: string): DriverCashStatus | "" {
  const status = String(value || "").trim();
  if (
    status === "collected" ||
    status === "handed_to_merchant" ||
    status === "disputed" ||
    status === "void"
  ) {
    return status;
  }
  return "";
}

export async function GET(req: Request) {
  try {
    requireAdminKey(req);
    const url = new URL(req.url);
    const weekKey = String(url.searchParams.get("weekKey") || "").trim() || getWeekKey(new Date());
    const status = normalizeStatus(String(url.searchParams.get("status") || "").trim());
    const limitRaw = Number(url.searchParams.get("limit") || 500);
    const limit = Math.max(1, Math.min(1000, Math.floor(Number.isFinite(limitRaw) ? limitRaw : 500)));

    await dbConnect();
    const match: Record<string, unknown> = { weekKey };
    if (status) match.status = status;

    const handoffs = await DriverCashHandoff.find(match)
      .select(
        "_id orderId businessId driverId weekKey amountCollectedRdp collectedAt handedToMerchantAt receiptRef proofUrl status dispute"
      )
      .sort({ collectedAt: -1, createdAt: -1 })
      .limit(limit)
      .lean<HandoffLean[]>();

    const orderIds = handoffs.map((row) => row.orderId);
    const driverIds = handoffs.map((row) => row.driverId);
    const businessIds = handoffs.map((row) => row.businessId);

    const [orders, drivers, businesses] = await Promise.all([
      Order.find({ _id: { $in: orderIds } })
        .select("_id orderNumber businessName")
        .lean<Array<{ _id: mongoose.Types.ObjectId; orderNumber?: string; businessName?: string }>>(),
      Driver.find({ _id: { $in: driverIds } })
        .select("_id name")
        .lean<Array<{ _id: mongoose.Types.ObjectId; name?: string }>>(),
      Business.find({ _id: { $in: businessIds } })
        .select("_id name")
        .lean<Array<{ _id: mongoose.Types.ObjectId; name?: string }>>(),
    ]);

    const orderMap = new Map(orders.map((row) => [String(row._id), row]));
    const driverMap = new Map(drivers.map((row) => [String(row._id), row]));
    const businessMap = new Map(businesses.map((row) => [String(row._id), row]));

    const rows = handoffs.map((handoff) => {
      const order = orderMap.get(String(handoff.orderId));
      const driver = driverMap.get(String(handoff.driverId));
      const business = businessMap.get(String(handoff.businessId));
      return {
        id: String(handoff._id),
        orderId: String(handoff.orderId),
        orderNumber: String(order?.orderNumber || ""),
        businessId: String(handoff.businessId),
        businessName: String(order?.businessName || business?.name || ""),
        driverId: String(handoff.driverId),
        driverName: String(driver?.name || ""),
        weekKey: String(handoff.weekKey || ""),
        amountCollectedRdp: roundCurrency(Number(handoff.amountCollectedRdp || 0)),
        status: handoff.status,
        collectedAt: handoff.collectedAt || null,
        handedToMerchantAt: handoff.handedToMerchantAt || null,
        receiptRef: String(handoff.receiptRef || "").trim() || null,
        proofUrl: String(handoff.proofUrl || "").trim() || null,
        disputeSummary: handoff.dispute
          ? {
              openedAt: handoff.dispute.openedAt || null,
              openedBy: handoff.dispute.openedBy || null,
              reason: String(handoff.dispute.reason || "").trim() || null,
              resolvedAt: handoff.dispute.resolvedAt || null,
              resolution: handoff.dispute.resolution || null,
            }
          : null,
      };
    });

    const totalsByStatus: Record<DriverCashStatus, number> = {
      collected: 0,
      handed_to_merchant: 0,
      disputed: 0,
      void: 0,
    };
    const totalsByDriverMap = new Map<string, { driverId: string; driverName: string; totalRdp: number; count: number }>();
    const totalsByBusinessMap = new Map<string, { businessId: string; businessName: string; totalRdp: number; count: number }>();

    for (const row of rows) {
      const amount = roundCurrency(Number(row.amountCollectedRdp || 0));
      totalsByStatus[row.status] = roundCurrency(totalsByStatus[row.status] + amount);

      const driverAgg = totalsByDriverMap.get(row.driverId) || {
        driverId: row.driverId,
        driverName: row.driverName,
        totalRdp: 0,
        count: 0,
      };
      driverAgg.totalRdp = roundCurrency(driverAgg.totalRdp + amount);
      driverAgg.count += 1;
      totalsByDriverMap.set(row.driverId, driverAgg);

      const businessAgg = totalsByBusinessMap.get(row.businessId) || {
        businessId: row.businessId,
        businessName: row.businessName,
        totalRdp: 0,
        count: 0,
      };
      businessAgg.totalRdp = roundCurrency(businessAgg.totalRdp + amount);
      businessAgg.count += 1;
      totalsByBusinessMap.set(row.businessId, businessAgg);
    }

    return ok({
      weekKey,
      rows,
      totals: {
        byStatus: totalsByStatus,
        byDriver: Array.from(totalsByDriverMap.values()).sort((a, b) => b.totalRdp - a.totalRdp),
        byBusiness: Array.from(totalsByBusinessMap.values()).sort((a, b) => b.totalRdp - a.totalRdp),
      },
    });
  } catch (error: unknown) {
    const err = error as ApiError;
    return fail(
      err.code || "SERVER_ERROR",
      err.message || "Could not load driver cash handoffs.",
      err.status || 500
    );
  }
}
