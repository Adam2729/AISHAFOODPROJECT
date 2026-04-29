import mongoose from "mongoose";
import { dbConnect } from "@/lib/mongodb";
import { ok, fail, readJson } from "@/lib/apiResponse";
import { requireAdminKey } from "@/lib/adminAuth";
import { logRequest } from "@/lib/logger";
import { FinanceAlert } from "@/models/FinanceAlert";

type ApiError = Error & { status?: number; code?: string };

type Body = {
  alertId?: unknown;
  by?: unknown;
  note?: unknown;
  confirm?: unknown;
};

export async function POST(req: Request) {
  const startedAt = Date.now();
  try {
    requireAdminKey(req);
    const body = await readJson<Body>(req);
    const alertId = String(body.alertId || "").trim();
    const by = String(body.by || "").trim();
    const note = String(body.note || "").trim();
    const confirm = String(body.confirm || "").trim();

    if (!mongoose.Types.ObjectId.isValid(alertId)) {
      return fail("VALIDATION_ERROR", "Invalid alertId.", 400);
    }
    if (confirm !== "RESOLVE") {
      return fail("VALIDATION_ERROR", 'confirm must equal "RESOLVE".', 400);
    }
    if (by.length > 60) {
      return fail("VALIDATION_ERROR", "by must be 60 characters or less.", 400);
    }
    if (note.length > 280) {
      return fail("VALIDATION_ERROR", "note must be 280 characters or less.", 400);
    }

    await dbConnect();
    const updated = await FinanceAlert.findOneAndUpdate(
      {
        _id: new mongoose.Types.ObjectId(alertId),
        status: { $in: ["open", "acknowledged", "resolved"] },
      },
      {
        $set: {
          status: "resolved",
          resolved: {
            by: by || "ops",
            at: new Date(),
            note: note || null,
          },
          lastSeenAt: new Date(),
        },
      },
      { returnDocument: "after" }
    ).lean();

    if (!updated) {
      return fail("NOT_FOUND", "Finance alert not found.", 404);
    }

    logRequest(req, {
      route: "admin.finance.alerts.resolve",
      status: 200,
      durationMs: Date.now() - startedAt,
      extra: {
        alertId,
        status: updated.status,
      },
    });

    return ok({
      alert: {
        id: String(updated._id),
        weekKey: String(updated.weekKey || ""),
        dayKey: String(updated.dayKey || ""),
        businessId: String(updated.businessId || ""),
        businessName: String(updated.businessName || "Business"),
        type: String(updated.type || ""),
        severity: String(updated.severity || "medium"),
        status: String(updated.status || "resolved"),
        meta: updated.meta || null,
        firstSeenAt: updated.firstSeenAt || null,
        lastSeenAt: updated.lastSeenAt || null,
        ack: updated.ack || null,
        resolved: updated.resolved || null,
      },
    });
  } catch (error: unknown) {
    const err = error as ApiError;
    const status = err.status || 500;
    logRequest(req, {
      route: "admin.finance.alerts.resolve",
      status,
      durationMs: Date.now() - startedAt,
      extra: {
        message: err.message || "Could not resolve finance alert.",
      },
    });
    return fail(
      err.code || "SERVER_ERROR",
      err.message || "Could not resolve finance alert.",
      status
    );
  }
}
