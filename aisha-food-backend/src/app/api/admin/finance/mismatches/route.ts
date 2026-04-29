import mongoose from "mongoose";
import { ok, fail } from "@/lib/apiResponse";
import { requireAdminKey } from "@/lib/adminAuth";
import { logRequest } from "@/lib/logger";
import { computeFinanceAlignmentForWeek } from "@/lib/financeAlignment";
import { OpsEvent } from "@/models/OpsEvent";

type ApiError = Error & { status?: number; code?: string };

const FINANCE_TYPES = [
  "FIN_MISSING_SETTLEMENT",
  "FIN_MISSING_CASH",
  "FIN_HASH_MISMATCH",
  "FIN_DIFF_OVER_THRESHOLD",
  "FIN_STALE_SUBMISSION",
] as const;

type OpsEventLean = {
  _id: mongoose.Types.ObjectId;
  type: (typeof FINANCE_TYPES)[number];
  severity?: "low" | "medium" | "high" | null;
  businessId: mongoose.Types.ObjectId;
  businessName?: string;
  weekKey: string;
  meta?: Record<string, unknown> | null;
  createdAt?: Date;
};

export async function GET(req: Request) {
  const startedAt = Date.now();
  try {
    requireAdminKey(req);
    const url = new URL(req.url);
    const weekKey = String(url.searchParams.get("weekKey") || "").trim();
    const businessId = String(url.searchParams.get("businessId") || "").trim();
    const limitRaw = Number(url.searchParams.get("limit") || 200);
    const limit = Math.max(1, Math.min(200, Math.floor(Number.isFinite(limitRaw) ? limitRaw : 200)));

    if (!weekKey) {
      return fail("VALIDATION_ERROR", "weekKey is required.", 400);
    }
    if (businessId && !mongoose.Types.ObjectId.isValid(businessId)) {
      return fail("VALIDATION_ERROR", "Invalid businessId.", 400);
    }

    const [alignment, latestAnomalies, anomalyCountsRows] = await Promise.all([
      computeFinanceAlignmentForWeek(weekKey, {
        limit,
        businessId: businessId || null,
      }),
      OpsEvent.find({
        weekKey,
        ...(businessId ? { businessId: new mongoose.Types.ObjectId(businessId) } : {}),
        type: { $in: [...FINANCE_TYPES] },
      })
        .select("_id type severity businessId businessName weekKey meta createdAt")
        .sort({ createdAt: -1 })
        .limit(10)
        .lean<OpsEventLean[]>(),
      OpsEvent.aggregate<{ _id: string; count: number }>([
        {
          $match: {
            weekKey,
            ...(businessId ? { businessId: new mongoose.Types.ObjectId(businessId) } : {}),
            type: { $in: [...FINANCE_TYPES] },
          },
        },
        {
          $group: {
            _id: "$type",
            count: { $sum: 1 },
          },
        },
      ]),
    ]);

    const countsByType = Object.fromEntries(
      FINANCE_TYPES.map((type) => [
        type,
        Number(anomalyCountsRows.find((row) => row._id === type)?.count || 0),
      ])
    ) as Record<(typeof FINANCE_TYPES)[number], number>;

    logRequest(req, {
      route: "admin.finance.mismatches",
      status: 200,
      durationMs: Date.now() - startedAt,
      extra: {
        weekKey,
        businessId: businessId || null,
        rows: alignment.rows.length,
      },
    });

    return ok({
      weekKey,
      summary: alignment.summary,
      rows: alignment.rows,
      anomalies: {
        countsByType,
        latest: latestAnomalies.map((row) => ({
          id: String(row._id),
          type: row.type,
          severity: row.severity || null,
          businessId: String(row.businessId),
          businessName: String(row.businessName || ""),
          weekKey: String(row.weekKey || ""),
          meta: row.meta || null,
          createdAt: row.createdAt || null,
        })),
      },
    });
  } catch (error: unknown) {
    const err = error as ApiError;
    const status = err.status || 500;
    logRequest(req, {
      route: "admin.finance.mismatches",
      status,
      durationMs: Date.now() - startedAt,
      extra: {
        message: err.message || "Could not load finance mismatches.",
      },
    });
    return fail(
      err.code || "SERVER_ERROR",
      err.message || "Could not load finance mismatches.",
      status
    );
  }
}
