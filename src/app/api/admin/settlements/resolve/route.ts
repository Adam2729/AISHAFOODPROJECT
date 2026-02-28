import mongoose from "mongoose";
import { dbConnect } from "@/lib/mongodb";
import { ok, fail, readJson } from "@/lib/apiResponse";
import { requireAdminKey } from "@/lib/adminAuth";
import { logRequest } from "@/lib/logger";
import { Settlement } from "@/models/Settlement";
import { SettlementAudit } from "@/models/SettlementAudit";

type ApiError = Error & { status?: number; code?: string };

type ResolutionStatus = "confirmed_correct" | "adjusted" | "merchant_disputed" | "writeoff";

type Body = {
  businessId?: string;
  weekKey?: string;
  resolutionStatus?: string;
  note?: string;
  attachmentUrl?: string;
  resolvedBy?: string;
  confirm?: string;
};

type SettlementLean = {
  _id: mongoose.Types.ObjectId;
  businessId: mongoose.Types.ObjectId;
  weekKey: string;
  status: "pending" | "collected" | "locked";
  resolutionStatus?: ResolutionStatus | null;
  resolutionNote?: string | null;
  resolutionAttachmentUrl?: string | null;
  resolvedAt?: Date | null;
  resolvedBy?: string | null;
};

const ALLOWED_RESOLUTION_STATUS: ResolutionStatus[] = [
  "confirmed_correct",
  "adjusted",
  "merchant_disputed",
  "writeoff",
];

export async function POST(req: Request) {
  const startedAt = Date.now();
  const finish = (
    response: ReturnType<typeof ok> | ReturnType<typeof fail>,
    status: number,
    extra?: Record<string, unknown>
  ) => {
    logRequest(req, {
      route: "admin.settlements.resolve",
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
    const resolutionStatus = String(body.resolutionStatus || "").trim() as ResolutionStatus;
    const note = String(body.note || "").trim();
    const attachmentUrl = String(body.attachmentUrl || "").trim();
    const resolvedBy = String(body.resolvedBy || "").trim();
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
    if (!ALLOWED_RESOLUTION_STATUS.includes(resolutionStatus)) {
      return finish(fail("VALIDATION_ERROR", "Invalid resolutionStatus.", 400), 400, {
        businessId,
        weekKey,
      });
    }
    if (note.length > 500) {
      return finish(fail("VALIDATION_ERROR", "note must be 500 characters or less.", 400), 400, {
        businessId,
        weekKey,
      });
    }
    if (attachmentUrl.length > 500) {
      return finish(fail("VALIDATION_ERROR", "attachmentUrl must be 500 characters or less.", 400), 400, {
        businessId,
        weekKey,
      });
    }
    if (resolvedBy.length > 60) {
      return finish(fail("VALIDATION_ERROR", "resolvedBy must be 60 characters or less.", 400), 400, {
        businessId,
        weekKey,
      });
    }
    if (confirm !== "RESOLVE") {
      return finish(fail("VALIDATION_ERROR", 'confirm must equal "RESOLVE".', 400), 400, {
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
    if (existing.status === "locked") {
      return finish(
        fail("SETTLEMENT_LOCKED", "Settlement is locked and cannot be modified.", 409),
        409,
        {
          businessId,
          weekKey,
        }
      );
    }

    const resolvedAt = new Date();
    const normalizedResolvedBy = resolvedBy || "admin";
    const updated = await Settlement.findOneAndUpdate(
      { businessId: objectBusinessId, weekKey },
      {
        $set: {
          resolutionStatus,
          resolutionNote: note || null,
          resolutionAttachmentUrl: attachmentUrl || null,
          resolvedAt,
          resolvedBy: normalizedResolvedBy,
        },
      },
      { returnDocument: "after" }
    ).lean<SettlementLean | null>();

    if (!updated) {
      return finish(fail("NOT_FOUND", "Settlement not found.", 404), 404, {
        businessId,
        weekKey,
      });
    }

    try {
      await SettlementAudit.create({
        businessId: objectBusinessId,
        weekKey,
        action: "SETTLEMENT_RESOLVED",
        meta: {
          resolutionStatus,
          noteLength: note.length,
          hasAttachment: Boolean(attachmentUrl),
          resolvedBy: normalizedResolvedBy || "admin",
        },
      });
    } catch (auditError: unknown) {
      console.error(
        JSON.stringify({
          type: "audit_write_error",
          route: "admin.settlements.resolve",
          action: "resolved",
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
      resolutionStatus,
    });
  } catch (e: unknown) {
    const err = e as ApiError;
    return finish(
      fail(err.code || "SERVER_ERROR", err.message || "Could not resolve settlement.", err.status || 500),
      err.status || 500,
      { error: err.message || "Could not resolve settlement." }
    );
  }
}
