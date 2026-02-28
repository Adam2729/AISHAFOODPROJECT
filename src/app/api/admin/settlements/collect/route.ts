import mongoose from "mongoose";
import { dbConnect } from "@/lib/mongodb";
import { ok, fail, readJson } from "@/lib/apiResponse";
import { requireAdminKey } from "@/lib/adminAuth";
import { logRequest } from "@/lib/logger";
import { Settlement } from "@/models/Settlement";
import { Order } from "@/models/Order";
import { SettlementAudit } from "@/models/SettlementAudit";
import { settlementHashV1 } from "@/lib/integrity";

type ApiError = Error & { status?: number; code?: string };

type Body = {
  businessId?: string;
  weekKey?: string;
  receiptRef?: string;
  collectorName?: string;
  collectionMethod?: "cash" | "transfer" | "other";
  receiptPhotoUrl?: string;
};

type SettlementLean = {
  _id: mongoose.Types.ObjectId;
  businessId: mongoose.Types.ObjectId;
  weekKey: string;
  status: "pending" | "collected" | "locked";
  ordersCount?: number;
  grossSubtotal?: number;
  feeTotal?: number;
  integrityHash?: string | null;
  integrityHashAlgo?: "sha256";
  integrityHashAt?: Date | null;
  integrityHashVersion?: number;
  receiptRef?: string;
  collectorName?: string;
  collectionMethod?: "cash" | "transfer" | "other";
  receiptPhotoUrl?: string;
};

export async function POST(req: Request) {
  const startedAt = Date.now();
  const finish = (
    response: ReturnType<typeof ok> | ReturnType<typeof fail>,
    status: number,
    extra?: Record<string, unknown>
  ) => {
    logRequest(req, {
      route: "admin.settlements.collect",
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
    const receiptRef = String(body.receiptRef || "").trim();
    const hasCollectorName = Object.prototype.hasOwnProperty.call(body, "collectorName");
    const hasCollectionMethod = Object.prototype.hasOwnProperty.call(body, "collectionMethod");
    const hasReceiptPhotoUrl = Object.prototype.hasOwnProperty.call(body, "receiptPhotoUrl");
    let collectorName = "";
    let collectionMethod: "cash" | "transfer" | "other" = "cash";
    let receiptPhotoUrl = "";

    if (hasCollectorName) {
      if (typeof body.collectorName !== "string") {
        return finish(fail("VALIDATION_ERROR", "collectorName must be a string."), 400, { businessId, weekKey });
      }
      collectorName = body.collectorName.trim();
      if (!collectorName || collectorName.length > 60) {
        return finish(fail("VALIDATION_ERROR", "collectorName must be 1 to 60 characters."), 400, {
          businessId,
          weekKey,
        });
      }
    }

    if (hasCollectionMethod) {
      if (typeof body.collectionMethod !== "string") {
        return finish(fail("VALIDATION_ERROR", "collectionMethod is invalid."), 400, { businessId, weekKey });
      }
      const normalizedMethod = body.collectionMethod.trim();
      if (normalizedMethod) {
        if (!["cash", "transfer", "other"].includes(normalizedMethod)) {
          return finish(fail("VALIDATION_ERROR", "collectionMethod is invalid."), 400, { businessId, weekKey });
        }
        collectionMethod = normalizedMethod as "cash" | "transfer" | "other";
      }
    }

    if (hasReceiptPhotoUrl) {
      if (typeof body.receiptPhotoUrl !== "string") {
        return finish(fail("VALIDATION_ERROR", "receiptPhotoUrl must be a string."), 400, { businessId, weekKey });
      }
      receiptPhotoUrl = body.receiptPhotoUrl.trim();
      if (receiptPhotoUrl && !/^https?:\/\//i.test(receiptPhotoUrl)) {
        return finish(fail("VALIDATION_ERROR", "receiptPhotoUrl must start with http."), 400, {
          businessId,
          weekKey,
        });
      }
    }

    if (!mongoose.Types.ObjectId.isValid(businessId) || !weekKey) {
      return finish(fail("VALIDATION_ERROR", "businessId and weekKey are required."), 400, {
        businessId,
        weekKey,
      });
    }

    await dbConnect();
    const collectedAt = new Date();

    const objectBusinessId = new mongoose.Types.ObjectId(businessId);
    const existing = await Settlement.findOne({ businessId: objectBusinessId, weekKey }).lean<SettlementLean | null>();
    if (!existing) {
      return finish(fail("NOT_FOUND", "Settlement not found.", 404), 404, {
        businessId,
        weekKey,
      });
    }
    if (existing.status === "locked") {
      return finish(
        fail("SETTLEMENT_LOCKED", "Settlement is locked and cannot be collected/edited.", 409),
        409,
        { businessId, weekKey }
      );
    }
    if (existing.status === "collected") {
      return finish(ok({ settlement: existing }), 200, {
        businessId,
        weekKey,
        status: "collected",
      });
    }
    const integrityHash = settlementHashV1({
      businessId: String(existing.businessId),
      weekKey: String(existing.weekKey),
      ordersCount: Number(existing.ordersCount || 0),
      grossSubtotal: Number(existing.grossSubtotal || 0),
      feeTotal: Number(existing.feeTotal || 0),
    });

    const settlement = await Settlement.findOneAndUpdate(
      { businessId: objectBusinessId, weekKey, status: "pending" },
      {
        $set: {
          status: "collected",
          collectedAt,
          receiptRef,
          collectorName,
          collectionMethod,
          receiptPhotoUrl,
          integrityHash,
          integrityHashAlgo: "sha256",
          integrityHashVersion: 1,
          integrityHashAt: collectedAt,
        },
      },
      { returnDocument: "after" }
    ).lean<SettlementLean | null>();
    if (!settlement) {
      const latest = await Settlement.findOne({ businessId: objectBusinessId, weekKey }).lean<SettlementLean | null>();
      if (!latest) {
        return finish(fail("NOT_FOUND", "Settlement not found.", 404), 404, {
          businessId,
          weekKey,
        });
      }
      if (latest.status === "locked") {
        return finish(
          fail("SETTLEMENT_LOCKED", "Settlement is locked and cannot be collected/edited.", 409),
          409,
          { businessId, weekKey }
        );
      }
      if (latest.status === "collected") {
        return finish(ok({ settlement: latest }), 200, {
          businessId,
          weekKey,
          status: "collected",
        });
      }
      return finish(fail("CONFLICT", "Settlement was updated by another process. Retry.", 409), 409, {
        businessId,
        weekKey,
      });
    }

    await Order.updateMany(
      {
        businessId: objectBusinessId,
        "settlement.weekKey": weekKey,
        status: "delivered",
        "settlement.counted": true,
      },
      {
        $set: {
          "settlement.status": "collected",
          "settlement.collectedAt": collectedAt,
          "settlement.receiptRef": receiptRef,
          "settlement.collectorName": collectorName,
          "settlement.collectionMethod": collectionMethod,
          "settlement.receiptPhotoUrl": receiptPhotoUrl,
        },
      }
    );

    try {
      const feeTotal = typeof settlement?.feeTotal === "number"
        ? Number(settlement.feeTotal)
        : null;
      await SettlementAudit.create({
        businessId: objectBusinessId,
        weekKey,
        action: "SETTLEMENT_COLLECTED",
        amount: feeTotal,
        meta: {
          receiptRef: receiptRef || "",
          collectorName: collectorName || "",
          collectionMethod,
          receiptPhotoUrl: Boolean(receiptPhotoUrl),
        },
      });
    } catch (auditError: unknown) {
      console.error(
        JSON.stringify({
          type: "audit_write_error",
          route: "admin.settlements.collect",
          action: "collected",
          businessId,
          weekKey,
          error: auditError instanceof Error ? auditError.message : "Failed to write audit event",
          timestamp: new Date().toISOString(),
        })
      );
    }

    return finish(ok({ settlement }), 200, {
      businessId,
      weekKey,
    });
  } catch (e: unknown) {
    const err = e as ApiError;
    return finish(
      fail(err.code || "SERVER_ERROR", err.message || "Could not collect settlement.", err.status || 500),
      err.status || 500,
      { error: err.message || "Could not collect settlement." }
    );
  }
}
