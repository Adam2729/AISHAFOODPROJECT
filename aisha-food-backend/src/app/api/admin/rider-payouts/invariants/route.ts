import mongoose from "mongoose";
import { dbConnect } from "@/lib/mongodb";
import { ok, fail } from "@/lib/apiResponse";
import { requireAdminKey } from "@/lib/adminAuth";
import { assertNotInMaintenance } from "@/lib/maintenance";
import { RiderPayout } from "@/models/RiderPayout";
import { RiderPayoutBatch } from "@/models/RiderPayoutBatch";
import { Order } from "@/models/Order";

type ApiError = Error & { status?: number; code?: string };
type RiderPayoutStatus = "pending" | "paid" | "void";

type RiderPayoutRow = {
  _id: mongoose.Types.ObjectId;
  orderId?: mongoose.Types.ObjectId;
  cityId?: mongoose.Types.ObjectId;
  weekKey?: string;
  amount?: number;
  deliveryFeeCharged?: number;
  platformMargin?: number;
  status?: RiderPayoutStatus;
  paidAt?: Date | null;
  paidByAdminId?: string | null;
};

type BatchRow = {
  _id: mongoose.Types.ObjectId;
  cityId: mongoose.Types.ObjectId;
  weekKey: string;
  status: "open" | "paid" | "void";
  payoutIds?: mongoose.Types.ObjectId[];
  payoutsCount?: number;
  totalAmount?: number;
  totalDeliveryFeeCharged?: number;
  totalPlatformMargin?: number;
};

type Violation = {
  payoutId: string;
  reason:
    | "AMOUNT_GT_FEE"
    | "MARGIN_MISMATCH"
    | "PAID_WITHOUT_PAID_AT"
    | "PAID_WITHOUT_PAID_BY"
    | "NON_PAID_WITH_PAID_AT"
    | "INVALID_STATUS"
    | "ORDER_NOT_DELIVERED"
    | "BATCH_TOTAL_MISMATCH"
    | "BATCH_COUNT_MISMATCH"
    | "BATCH_CITY_WEEK_MISMATCH";
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

function withinTolerance(actual: number, expected: number, tolerance = 1) {
  return Math.abs(actual - expected) <= tolerance;
}

export async function GET(req: Request) {
  try {
    requireAdminKey(req);
    await assertNotInMaintenance();

    const url = new URL(req.url);
    const limitRaw = Number(url.searchParams.get("limit") || 200);
    const limit = Math.max(1, Math.min(2000, Math.floor(Number.isFinite(limitRaw) ? limitRaw : 200)));
    const cityId = String(url.searchParams.get("cityId") || "").trim();
    const batchId = String(url.searchParams.get("batchId") || "").trim();

    if (cityId && !mongoose.Types.ObjectId.isValid(cityId)) {
      return fail("VALIDATION_ERROR", "Invalid cityId.", 400);
    }
    if (batchId && !mongoose.Types.ObjectId.isValid(batchId)) {
      return fail("VALIDATION_ERROR", "Invalid batchId.", 400);
    }

    await dbConnect();
    const payoutQuery: Record<string, unknown> = {};
    if (cityId) payoutQuery.cityId = new mongoose.Types.ObjectId(cityId);

    const rows = await RiderPayout.find(payoutQuery)
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean<RiderPayoutRow[]>();

    const orderIds = rows
      .map((row) => row.orderId)
      .filter((id): id is mongoose.Types.ObjectId => Boolean(id))
      .map((id) => new mongoose.Types.ObjectId(String(id)));
    const orders = orderIds.length
      ? await Order.find({ _id: { $in: orderIds } })
          .select("_id status")
          .lean<Array<{ _id: mongoose.Types.ObjectId; status?: string }>>()
      : [];
    const orderStatusMap = new Map(orders.map((row) => [String(row._id), String(row.status || "")]));

    const violations: Violation[] = [];
    for (const row of rows) {
      const payoutId = String(row._id || "");
      const status = normalizeStatus(row.status);
      const amount = asAmount(row.amount);
      const deliveryFeeCharged = asAmount(row.deliveryFeeCharged);
      const platformMargin = asAmount(row.platformMargin);

      if (!status) {
        violations.push({ payoutId, reason: "INVALID_STATUS", details: { status: row.status || null } });
        continue;
      }

      if (amount > deliveryFeeCharged) {
        violations.push({
          payoutId,
          reason: "AMOUNT_GT_FEE",
          details: { amount, deliveryFeeCharged },
        });
      }

      const expectedMargin = Math.max(0, deliveryFeeCharged - amount);
      if (!withinTolerance(platformMargin, expectedMargin, 1)) {
        violations.push({
          payoutId,
          reason: "MARGIN_MISMATCH",
          details: { amount, deliveryFeeCharged, platformMargin, expected: expectedMargin },
        });
      }

      if (status === "paid" && !row.paidAt) {
        violations.push({
          payoutId,
          reason: "PAID_WITHOUT_PAID_AT",
          details: { paidAt: row.paidAt || null },
        });
      }
      if (status === "paid" && !String(row.paidByAdminId || "").trim()) {
        violations.push({
          payoutId,
          reason: "PAID_WITHOUT_PAID_BY",
          details: { paidByAdminId: row.paidByAdminId || null },
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

    const batchQuery: Record<string, unknown> = { status: { $in: ["open", "paid"] } };
    if (cityId) batchQuery.cityId = new mongoose.Types.ObjectId(cityId);
    if (batchId) batchQuery._id = new mongoose.Types.ObjectId(batchId);

    const batches = await RiderPayoutBatch.find(batchQuery)
      .sort({ updatedAt: -1, _id: -1 })
      .limit(Math.max(200, Math.ceil(limit / 2)))
      .lean<BatchRow[]>();

    for (const batch of batches) {
      const ids = Array.isArray(batch.payoutIds) ? batch.payoutIds : [];
      const payoutRows = ids.length
        ? await RiderPayout.find({ _id: { $in: ids } })
            .select("_id cityId weekKey amount deliveryFeeCharged platformMargin")
            .lean<
              Array<{
                _id: mongoose.Types.ObjectId;
                cityId?: mongoose.Types.ObjectId;
                weekKey?: string;
                amount?: number;
                deliveryFeeCharged?: number;
                platformMargin?: number;
              }>
            >()
        : [];

      if (Number(batch.payoutsCount || 0) !== ids.length) {
        violations.push({
          payoutId: `batch:${String(batch._id)}`,
          reason: "BATCH_COUNT_MISMATCH",
          details: {
            expectedPayoutsCount: Number(batch.payoutsCount || 0),
            payoutIdsLength: ids.length,
          },
        });
      }

      let totalAmount = 0;
      let totalDeliveryFeeCharged = 0;
      let totalPlatformMargin = 0;
      for (const payout of payoutRows) {
        totalAmount += asAmount(payout.amount);
        totalDeliveryFeeCharged += asAmount(payout.deliveryFeeCharged);
        totalPlatformMargin += asAmount(payout.platformMargin);

        if (
          String(payout.cityId || "") !== String(batch.cityId) ||
          String(payout.weekKey || "") !== String(batch.weekKey || "")
        ) {
          violations.push({
            payoutId: `batch:${String(batch._id)}`,
            reason: "BATCH_CITY_WEEK_MISMATCH",
            details: {
              batchCityId: String(batch.cityId),
              batchWeekKey: String(batch.weekKey || ""),
              payoutId: String(payout._id),
              payoutCityId: String(payout.cityId || ""),
              payoutWeekKey: String(payout.weekKey || ""),
            },
          });
        }
      }

      const amountMatches = withinTolerance(Number(batch.totalAmount || 0), totalAmount, 1);
      const feeMatches = withinTolerance(
        Number(batch.totalDeliveryFeeCharged || 0),
        totalDeliveryFeeCharged,
        1
      );
      const marginMatches = withinTolerance(
        Number(batch.totalPlatformMargin || 0),
        totalPlatformMargin,
        1
      );

      if (!amountMatches || !feeMatches || !marginMatches) {
        violations.push({
          payoutId: `batch:${String(batch._id)}`,
          reason: "BATCH_TOTAL_MISMATCH",
          details: {
            expected: {
              totalAmount: Number(batch.totalAmount || 0),
              totalDeliveryFeeCharged: Number(batch.totalDeliveryFeeCharged || 0),
              totalPlatformMargin: Number(batch.totalPlatformMargin || 0),
            },
            actual: {
              totalAmount,
              totalDeliveryFeeCharged,
              totalPlatformMargin,
            },
          },
        });
      }
    }

    return ok({
      scanned: rows.length,
      batchScanned: batches.length,
      limit,
      cityId: cityId || null,
      batchId: batchId || null,
      violationsCount: violations.length,
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
