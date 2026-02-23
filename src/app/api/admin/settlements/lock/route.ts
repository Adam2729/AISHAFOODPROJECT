import mongoose from "mongoose";
import { dbConnect } from "@/lib/mongodb";
import { ok, fail, readJson } from "@/lib/apiResponse";
import { requireAdminKey } from "@/lib/adminAuth";
import { logRequest } from "@/lib/logger";
import { Settlement } from "@/models/Settlement";
import { SettlementAudit } from "@/models/SettlementAudit";

type ApiError = Error & { status?: number; code?: string };

type Body = {
  businessId?: string;
  weekKey?: string;
  confirm?: string;
};

type SettlementLean = {
  _id: mongoose.Types.ObjectId;
  businessId: mongoose.Types.ObjectId;
  weekKey: string;
  status: "pending" | "collected" | "locked";
  feeTotal?: number;
  receiptRef?: string;
  collectionMethod?: "cash" | "transfer" | "other";
  lockedAt?: Date | null;
  lockedBy?: string | null;
};

export async function POST(req: Request) {
  const startedAt = Date.now();
  const finish = (
    response: ReturnType<typeof ok> | ReturnType<typeof fail>,
    status: number,
    extra?: Record<string, unknown>
  ) => {
    logRequest(req, {
      route: "admin.settlements.lock",
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
    const confirm = String(body.confirm || "").trim();

    if (!mongoose.Types.ObjectId.isValid(businessId)) {
      return finish(fail("VALIDATION_ERROR", "Invalid businessId.", 400), 400, {
        businessId,
        weekKey,
      });
    }
    if (!weekKey) {
      return finish(fail("VALIDATION_ERROR", "weekKey is required.", 400), 400, {
        businessId,
      });
    }
    if (confirm !== "LOCK") {
      return finish(fail("VALIDATION_ERROR", 'confirm must equal "LOCK".', 400), 400, {
        businessId,
        weekKey,
      });
    }

    await dbConnect();
    const objectBusinessId = new mongoose.Types.ObjectId(businessId);
    const existing = await Settlement.findOne({
      businessId: objectBusinessId,
      weekKey,
    }).lean<SettlementLean | null>();

    if (!existing) {
      return finish(fail("NOT_FOUND", "Settlement not found.", 404), 404, {
        businessId,
        weekKey,
      });
    }
    if (existing.status === "pending") {
      return finish(fail("INVALID_STATE", "Cannot lock a pending settlement.", 400), 400, {
        businessId,
        weekKey,
      });
    }
    if (existing.status === "locked") {
      return finish(ok({ settlement: existing }), 200, {
        businessId,
        weekKey,
        status: existing.status,
      });
    }

    const lockedAt = new Date();
    const updated = await Settlement.findOneAndUpdate(
      {
        businessId: objectBusinessId,
        weekKey,
        status: "collected",
      },
      {
        $set: {
          status: "locked",
          lockedAt,
          lockedBy: "admin",
        },
      },
      { returnDocument: "after" }
    ).lean<SettlementLean | null>();

    if (!updated) {
      const latest = await Settlement.findOne({ businessId: objectBusinessId, weekKey }).lean<SettlementLean | null>();
      if (!latest) {
        return finish(fail("NOT_FOUND", "Settlement not found.", 404), 404, {
          businessId,
          weekKey,
        });
      }
      if (latest.status === "locked") {
        return finish(ok({ settlement: latest }), 200, {
          businessId,
          weekKey,
          status: latest.status,
        });
      }
      if (latest.status === "pending") {
        return finish(fail("INVALID_STATE", "Cannot lock a pending settlement.", 400), 400, {
          businessId,
          weekKey,
        });
      }
      return finish(fail("CONFLICT", "Settlement was updated by another process. Retry.", 409), 409, {
        businessId,
        weekKey,
      });
    }

    try {
      await SettlementAudit.create({
        businessId: objectBusinessId,
        weekKey,
        action: "SETTLEMENT_LOCKED",
        amount: typeof updated.feeTotal === "number" ? Number(updated.feeTotal) : null,
        meta: {
          fromStatus: "collected",
          toStatus: "locked",
          receiptRef: String(updated.receiptRef || ""),
          collectionMethod: String(updated.collectionMethod || ""),
        },
      });
    } catch (auditError: unknown) {
      console.error(
        JSON.stringify({
          type: "audit_write_error",
          route: "admin.settlements.lock",
          action: "locked",
          businessId,
          weekKey,
          error: auditError instanceof Error ? auditError.message : "Failed to write audit event",
          timestamp: new Date().toISOString(),
        })
      );
    }

    return finish(ok({ settlement: updated }), 200, {
      businessId,
      weekKey,
      status: updated.status,
    });
  } catch (e: unknown) {
    const err = e as ApiError;
    return finish(fail(err.code || "SERVER_ERROR", err.message || "Could not lock settlement.", err.status || 500), err.status || 500, {
      error: err.message || "Could not lock settlement.",
    });
  }
}
