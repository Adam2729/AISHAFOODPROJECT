import mongoose from "mongoose";
import { dbConnect } from "@/lib/mongodb";
import { ok, fail, readJson } from "@/lib/apiResponse";
import { requireAdminKey } from "@/lib/adminAuth";
import { logRequest } from "@/lib/logger";
import { Settlement } from "@/models/Settlement";
import { SettlementAudit } from "@/models/SettlementAudit";
import { Order } from "@/models/Order";
import { settlementHashV1 } from "@/lib/integrity";

type ApiError = Error & { status?: number; code?: string };

type Body = {
  businessId?: string;
  weekKey?: string;
};

type SettlementLean = {
  _id: mongoose.Types.ObjectId;
  businessId: mongoose.Types.ObjectId;
  weekKey: string;
  status: "pending" | "collected" | "locked";
  ordersCount?: number;
  grossSubtotal?: number;
  feeTotal?: number;
  integrityHash?: string;
};

type AggregateRow = {
  _id: null;
  ordersCount: number;
  grossSubtotal: number;
  feeTotal: number;
};

function toNumber(value: unknown) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function isNonZero(value: number) {
  return Math.abs(value) > 0.000001;
}

export async function POST(req: Request) {
  const startedAt = Date.now();
  const finish = (
    response: ReturnType<typeof ok> | ReturnType<typeof fail>,
    status: number,
    extra?: Record<string, unknown>
  ) => {
    logRequest(req, {
      route: "admin.settlements.recompute",
      status,
      durationMs: Date.now() - startedAt,
      extra,
    });
    return response;
  };

  try {
    requireAdminKey(req);
    const body = await readJson<Body>(req);
    const businessId = String(body.businessId || "").trim();
    const weekKey = String(body.weekKey || "").trim();

    if (!mongoose.Types.ObjectId.isValid(businessId)) {
      return finish(fail("VALIDATION_ERROR", "Invalid businessId.", 400), 400, {
        businessId,
        weekKey,
      });
    }
    if (!weekKey) {
      return finish(fail("VALIDATION_ERROR", "weekKey is required.", 400), 400, { businessId });
    }

    await dbConnect();
    const objectBusinessId = new mongoose.Types.ObjectId(businessId);

    const settlement = await Settlement.findOne({ businessId: objectBusinessId, weekKey }).lean<SettlementLean | null>();

    const aggregate = await Order.aggregate<AggregateRow>([
      {
        $match: {
          businessId: objectBusinessId,
          status: "delivered",
          "settlement.weekKey": weekKey,
          "settlement.counted": true,
        },
      },
      {
        $group: {
          _id: null,
          ordersCount: { $sum: 1 },
          grossSubtotal: { $sum: { $ifNull: ["$subtotal", 0] } },
          feeTotal: { $sum: { $ifNull: ["$commissionAmount", 0] } },
        },
      },
    ]);

    const expected = {
      ordersCount: toNumber(aggregate?.[0]?.ordersCount),
      grossSubtotal: toNumber(aggregate?.[0]?.grossSubtotal),
      feeTotal: toNumber(aggregate?.[0]?.feeTotal),
    };

    const storedExists = Boolean(settlement);
    const stored = settlement
      ? {
          ordersCount: toNumber(settlement.ordersCount),
          grossSubtotal: toNumber(settlement.grossSubtotal),
          feeTotal: toNumber(settlement.feeTotal),
          integrityHash: String(settlement.integrityHash || "").trim(),
        }
      : null;
    const locked = settlement?.status === "locked";
    const integrityHasHash = Boolean(stored?.integrityHash);
    const expectedHash = settlement
      ? settlementHashV1({
          businessId: String(settlement.businessId),
          weekKey: settlement.weekKey,
          ordersCount: toNumber(settlement.ordersCount),
          grossSubtotal: toNumber(settlement.grossSubtotal),
          feeTotal: toNumber(settlement.feeTotal),
        })
      : null;
    const hashMatches = settlement
      ? (integrityHasHash ? expectedHash === stored?.integrityHash : null)
      : null;

    const diff = {
      ordersCount: expected.ordersCount - toNumber(stored?.ordersCount),
      grossSubtotal: expected.grossSubtotal - toNumber(stored?.grossSubtotal),
      feeTotal: expected.feeTotal - toNumber(stored?.feeTotal),
    };

    const mismatch = isNonZero(diff.ordersCount) || isNonZero(diff.grossSubtotal) || isNonZero(diff.feeTotal);

    try {
      await SettlementAudit.create({
        businessId: objectBusinessId,
        weekKey,
        action: "SETTLEMENT_RECOMPUTE",
        amount: expected.feeTotal,
        meta: {
          mismatch,
          integrityHashMatches: hashMatches,
          expectedFeeTotal: expected.feeTotal,
          storedFeeTotal: stored?.feeTotal ?? null,
          diffFeeTotal: diff.feeTotal,
          expectedOrdersCount: expected.ordersCount,
          storedOrdersCount: stored?.ordersCount ?? null,
        },
      });
    } catch (auditError: unknown) {
      console.error(
        JSON.stringify({
          type: "audit_write_error",
          route: "admin.settlements.recompute",
          action: "recompute",
          businessId,
          weekKey,
          error: auditError instanceof Error ? auditError.message : "Failed to write audit event",
          timestamp: new Date().toISOString(),
        })
      );
    }

    return finish(
      ok({
        businessId,
        weekKey,
        locked,
        storedExists,
        expected,
        stored,
        diff,
        mismatch,
        integrity: {
          hasHash: integrityHasHash,
          hashMatches,
          storedHash: integrityHasHash ? stored?.integrityHash || null : null,
          expectedHash: integrityHasHash ? expectedHash : null,
        },
        computedAt: new Date().toISOString(),
      }),
      200,
      {
        businessId,
        weekKey,
        mismatch,
        integrityHashMatches: hashMatches,
        locked,
      }
    );
  } catch (e: unknown) {
    const err = e as ApiError;
    return finish(
      fail(err.code || "SERVER_ERROR", err.message || "Could not recompute settlement.", err.status || 500),
      err.status || 500,
      {
        error: err.message || "Could not recompute settlement.",
      }
    );
  }
}
