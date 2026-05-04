import mongoose from "mongoose";
import { dbConnect } from "@/lib/mongodb";
import { ok, fail } from "@/lib/apiResponse";
import { requireAdminKey } from "@/lib/adminAuth";
import { logRequest } from "@/lib/logger";
import { FinanceAlert } from "@/models/FinanceAlert";

type ApiError = Error & { status?: number; code?: string };

type FinanceAlertRow = {
  _id: mongoose.Types.ObjectId;
  weekKey: string;
  dayKey: string;
  businessId: mongoose.Types.ObjectId;
  businessName: string;
  type: string;
  severity: "high" | "medium" | "low";
  status: "open" | "acknowledged" | "resolved";
  meta?: Record<string, unknown> | null;
  firstSeenAt?: Date | null;
  lastSeenAt?: Date | null;
  ack?: { by?: string | null; at?: Date | null; note?: string | null } | null;
  resolved?: { by?: string | null; at?: Date | null; note?: string | null } | null;
};

const STATUS_VALUES = new Set(["open", "acknowledged", "resolved"]);
const SEVERITY_VALUES = new Set(["high", "medium", "low"]);
const STATUS_RANK = { open: 0, acknowledged: 1, resolved: 2 } as const;
const SEVERITY_RANK = { high: 0, medium: 1, low: 2 } as const;

function sortAlerts(a: FinanceAlertRow, b: FinanceAlertRow) {
  const statusRankDiff =
    STATUS_RANK[a.status as keyof typeof STATUS_RANK] -
    STATUS_RANK[b.status as keyof typeof STATUS_RANK];
  if (statusRankDiff !== 0) return statusRankDiff;
  const severityRankDiff =
    SEVERITY_RANK[a.severity as keyof typeof SEVERITY_RANK] -
    SEVERITY_RANK[b.severity as keyof typeof SEVERITY_RANK];
  if (severityRankDiff !== 0) return severityRankDiff;
  const aTime = new Date(a.lastSeenAt || a.firstSeenAt || 0).getTime();
  const bTime = new Date(b.lastSeenAt || b.firstSeenAt || 0).getTime();
  if (aTime !== bTime) return bTime - aTime;
  return String(a.businessName || "").localeCompare(String(b.businessName || ""), "es", {
    sensitivity: "base",
  });
}

export async function GET(req: Request) {
  const startedAt = Date.now();
  try {
    requireAdminKey(req);
    const url = new URL(req.url);
    const weekKey = String(url.searchParams.get("weekKey") || "").trim();
    const status = String(url.searchParams.get("status") || "").trim().toLowerCase();
    const severity = String(url.searchParams.get("severity") || "").trim().toLowerCase();
    const businessId = String(url.searchParams.get("businessId") || "").trim();
    const limitRaw = Number(url.searchParams.get("limit") || 100);
    const limit = Math.max(1, Math.min(200, Math.floor(Number.isFinite(limitRaw) ? limitRaw : 100)));

    if (!weekKey) return fail("VALIDATION_ERROR", "weekKey is required.", 400);
    if (status && !STATUS_VALUES.has(status)) {
      return fail("VALIDATION_ERROR", "Invalid status filter.", 400);
    }
    if (severity && !SEVERITY_VALUES.has(severity)) {
      return fail("VALIDATION_ERROR", "Invalid severity filter.", 400);
    }
    if (businessId && !mongoose.Types.ObjectId.isValid(businessId)) {
      return fail("VALIDATION_ERROR", "Invalid businessId.", 400);
    }

    await dbConnect();

    const match: Record<string, unknown> = { weekKey };
    if (businessId) match.businessId = new mongoose.Types.ObjectId(businessId);

    const deduped = await FinanceAlert.aggregate<FinanceAlertRow>([
      { $match: match },
      { $sort: { dayKey: -1, lastSeenAt: -1, createdAt: -1 } },
      {
        $group: {
          _id: {
            businessId: "$businessId",
            weekKey: "$weekKey",
            type: "$type",
          },
          doc: { $first: "$$ROOT" },
        },
      },
      { $replaceRoot: { newRoot: "$doc" } },
    ]);

    const filtered = deduped.filter((row) => {
      if (status && row.status !== status) return false;
      if (severity && row.severity !== severity) return false;
      return true;
    });
    filtered.sort(sortAlerts);

    const summary = deduped.reduce(
      (acc, row) => {
        if (row.status === "open") acc.openTotal += 1;
        if (row.status === "open" && row.severity === "high") acc.openHigh += 1;
        if (row.status === "acknowledged") acc.acknowledgedTotal += 1;
        if (row.status === "resolved") acc.resolvedTotal += 1;
        return acc;
      },
      {
        openHigh: 0,
        openTotal: 0,
        acknowledgedTotal: 0,
        resolvedTotal: 0,
      }
    );

    logRequest(req, {
      route: "admin.finance.alerts",
      status: 200,
      durationMs: Date.now() - startedAt,
      extra: {
        weekKey,
        returned: Math.min(filtered.length, limit),
      },
    });

    return ok({
      weekKey,
      summary,
      alerts: filtered.slice(0, limit).map((row) => ({
        id: String(row._id),
        weekKey: String(row.weekKey || ""),
        dayKey: String(row.dayKey || ""),
        businessId: String(row.businessId),
        businessName: String(row.businessName || "Business"),
        type: String(row.type || ""),
        severity: row.severity,
        status: row.status,
        meta: row.meta || null,
        firstSeenAt: row.firstSeenAt || null,
        lastSeenAt: row.lastSeenAt || null,
        ack: {
          by: row.ack?.by || null,
          at: row.ack?.at || null,
          note: row.ack?.note || null,
        },
        resolved: {
          by: row.resolved?.by || null,
          at: row.resolved?.at || null,
          note: row.resolved?.note || null,
        },
      })),
    });
  } catch (error: unknown) {
    const err = error as ApiError;
    const status = err.status || 500;
    logRequest(req, {
      route: "admin.finance.alerts",
      status,
      durationMs: Date.now() - startedAt,
      extra: { message: err.message || "Could not load finance alerts." },
    });
    return fail(
      err.code || "SERVER_ERROR",
      err.message || "Could not load finance alerts.",
      status
    );
  }
}
