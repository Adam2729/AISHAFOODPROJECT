import mongoose from "mongoose";
import { dbConnect } from "@/lib/mongodb";
import { ok, fail } from "@/lib/apiResponse";
import { requireAdminKey } from "@/lib/adminAuth";
import { RiderPayout } from "@/models/RiderPayout";
import { Order } from "@/models/Order";

type ApiError = Error & { status?: number; code?: string };

type RiderPayoutStatus = "pending" | "paid" | "void";

type RiderPayoutRow = {
  _id: unknown;
  orderId?: unknown;
  cityId?: unknown;
  driverId?: unknown;
  businessId?: unknown;
  amount?: number;
  deliveryFeeCharged?: number;
  platformMargin?: number;
  status?: RiderPayoutStatus;
  paidAt?: Date | null;
  createdAt?: Date;
  updatedAt?: Date;
};

type Violation = {
  payoutId: string;
  reason:
    | "AMOUNT_GT_FEE"
    | "MARGIN_MISMATCH"
    | "PAID_WITHOUT_PAID_AT"
    | "NON_PAID_WITH_PAID_AT"
    | "INVALID_STATUS"
    | "ORDER_NOT_DELIVERED";
  details: Record<string, unknown>;
};

function normalizeStatus(value: unknown): RiderPayoutStatus | "" {
  const status = String(value || "").trim().toLowerCase();
  if (status === "pending" || status === "paid" || status === "void") return status;
  return "";
}

function asAmount(value: unknown) {
  const parsed = Number(value || 0);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.round(parsed));
}

export async function GET(req: Request) {
  try {
    requireAdminKey(req);
    const url = new URL(req.url);
    const limitRaw = Number(url.searchParams.get("limit") || 200);
    const limit = Math.max(1, Math.min(2000, Math.floor(Number.isFinite(limitRaw) ? limitRaw : 200)));
    const cityId = String(url.searchParams.get("cityId") || "").trim();
    if (cityId && !mongoose.Types.ObjectId.isValid(cityId)) {
      return fail("VALIDATION_ERROR", "Invalid cityId.", 400);
    }

    await dbConnect();
    const query: Record<string, unknown> = {};
    if (cityId) query.cityId = new mongoose.Types.ObjectId(cityId);

    const rows = await RiderPayout.find(query)
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean<RiderPayoutRow[]>();

    const orderIds = rows
      .map((row) => row.orderId)
      .filter((id) => mongoose.Types.ObjectId.isValid(String(id || "")))
      .map((id) => new mongoose.Types.ObjectId(String(id)));
    const orders = await Order.find({ _id: { $in: orderIds } })
      .select("_id status")
      .lean<Array<{ _id: mongoose.Types.ObjectId; status?: string }>>();
    const orderStatusMap = new Map(orders.map((row) => [String(row._id), String(row.status || "")]));

    const violations: Violation[] = [];
    for (const row of rows) {
      const payoutId = String(row._id || "");
      const status = normalizeStatus(row.status);
      const amount = asAmount(row.amount);
      const deliveryFeeCharged = asAmount(row.deliveryFeeCharged);
      const platformMargin = asAmount(row.platformMargin);

      if (!status) {
        violations.push({
          payoutId,
          reason: "INVALID_STATUS",
          details: { status: row.status || null },
        });
        continue;
      }

      if (amount > deliveryFeeCharged) {
        violations.push({
          payoutId,
          reason: "AMOUNT_GT_FEE",
          details: { amount, deliveryFeeCharged },
        });
      }

      if (platformMargin !== deliveryFeeCharged - amount) {
        violations.push({
          payoutId,
          reason: "MARGIN_MISMATCH",
          details: { amount, deliveryFeeCharged, platformMargin, expected: deliveryFeeCharged - amount },
        });
      }

      if (status === "paid" && !row.paidAt) {
        violations.push({
          payoutId,
          reason: "PAID_WITHOUT_PAID_AT",
          details: { status, paidAt: row.paidAt || null },
        });
      }

      if (status !== "paid" && row.paidAt) {
        violations.push({
          payoutId,
          reason: "NON_PAID_WITH_PAID_AT",
          details: { status, paidAt: row.paidAt },
        });
      }

      const orderId = String(row.orderId || "");
      if (orderId) {
        const orderStatus = String(orderStatusMap.get(orderId) || "").trim().toLowerCase();
        if (orderStatus && orderStatus !== "delivered") {
          violations.push({
            payoutId,
            reason: "ORDER_NOT_DELIVERED",
            details: { orderId, orderStatus },
          });
        }
      }
    }

    return ok({
      scanned: rows.length,
      limit,
      cityId: cityId || null,
      violationsCount: violations.length,
      ok: violations.length === 0,
      violations,
    });
  } catch (error: unknown) {
    const err = error as ApiError;
    return fail(
      err.code || "SERVER_ERROR",
      err.message || "Could not validate rider payout invariants.",
      err.status || 500
    );
  }
}
