import mongoose from "mongoose";
import { dbConnect } from "@/lib/mongodb";
import { ok, fail } from "@/lib/apiResponse";
import { requireAdminKey } from "@/lib/adminAuth";
import { logRequest } from "@/lib/logger";
import { getWeekKey } from "@/lib/geo";
import { FinanceAlert } from "@/models/FinanceAlert";

type ApiError = Error & { status?: number; code?: string };

type FinanceAlertRow = {
  _id: mongoose.Types.ObjectId;
  businessId: mongoose.Types.ObjectId;
  businessName: string;
  weekKey: string;
  dayKey: string;
  type: string;
  severity: "high" | "medium" | "low";
  status: "open" | "acknowledged" | "resolved";
  meta?: Record<string, unknown> | null;
  lastSeenAt?: Date | null;
};

function getUtcDayKey(dateInput = new Date()) {
  return dateInput.toISOString().slice(0, 10);
}

function severityRank(severity: "high" | "medium" | "low") {
  if (severity === "high") return 0;
  if (severity === "medium") return 1;
  return 2;
}

function pickDiffLabel(meta: Record<string, unknown> | null | undefined) {
  const diffs = (meta?.diffs || {}) as Record<string, unknown>;
  const diffFeeTotal = Number(diffs.diffFeeTotal || 0);
  const diffNet = Number(diffs.diffCashNetVsDeliveredNet || 0);
  if (Number.isFinite(diffFeeTotal) && diffFeeTotal !== 0) {
    return `Dif Fee: ${diffFeeTotal >= 0 ? "+" : ""}${diffFeeTotal.toFixed(2)}`;
  }
  if (Number.isFinite(diffNet) && diffNet !== 0) {
    return `Dif Net: ${diffNet >= 0 ? "+" : ""}${diffNet.toFixed(2)}`;
  }
  return "";
}

function buildDigestMessage(params: {
  weekKey: string;
  dayKey: string;
  high: number;
  medium: number;
  low: number;
  top: FinanceAlertRow[];
}) {
  const lines: string[] = [];
  lines.push(`📊 Aisha Food - Alertas Finanzas (${params.weekKey}, ${params.dayKey})`);
  lines.push("");
  lines.push(`🔴 Altas: ${params.high} | 🟠 Medias: ${params.medium} | 🟢 Bajas: ${params.low}`);
  lines.push("");

  if (!params.top.length) {
    lines.push("Sin alertas abiertas.");
  } else {
    params.top.forEach((alert, index) => {
      const diffLabel = pickDiffLabel(alert.meta || null);
      const suffix = diffLabel ? ` - ${diffLabel}` : "";
      lines.push(`${index + 1}) ${alert.businessName} - ${alert.type}${suffix}`);
    });
  }

  lines.push("");
  lines.push("Abrir Ops: /admin/ops (Finance Alerts)");
  return lines.join("\n");
}

export async function GET(req: Request) {
  const startedAt = Date.now();
  try {
    requireAdminKey(req);
    const url = new URL(req.url);
    const weekKey = String(url.searchParams.get("weekKey") || "").trim() || getWeekKey(new Date());
    const dayKey = String(url.searchParams.get("dayKey") || "").trim() || getUtcDayKey(new Date());

    await dbConnect();
    const deduped = await FinanceAlert.aggregate<FinanceAlertRow>([
      {
        $match: {
          weekKey,
        },
      },
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
      { $match: { status: "open" } },
    ]);

    deduped.sort((a, b) => {
      const severityDiff = severityRank(a.severity) - severityRank(b.severity);
      if (severityDiff !== 0) return severityDiff;
      const aTime = new Date(a.lastSeenAt || 0).getTime();
      const bTime = new Date(b.lastSeenAt || 0).getTime();
      if (aTime !== bTime) return bTime - aTime;
      return String(a.businessName || "").localeCompare(String(b.businessName || ""), "es", {
        sensitivity: "base",
      });
    });

    const counts = deduped.reduce(
      (acc, alert) => {
        if (alert.severity === "high") acc.high += 1;
        if (alert.severity === "medium") acc.medium += 1;
        if (alert.severity === "low") acc.low += 1;
        acc.openTotal += 1;
        return acc;
      },
      {
        high: 0,
        medium: 0,
        low: 0,
        openTotal: 0,
      }
    );

    const top = deduped.slice(0, 12);
    const messageEs = buildDigestMessage({
      weekKey,
      dayKey,
      high: counts.high,
      medium: counts.medium,
      low: counts.low,
      top,
    });

    logRequest(req, {
      route: "admin.finance.digest",
      status: 200,
      durationMs: Date.now() - startedAt,
      extra: {
        weekKey,
        dayKey,
        openTotal: counts.openTotal,
      },
    });

    return ok({
      weekKey,
      dayKey,
      counts,
      top: top.map((alert) => ({
        id: String(alert._id),
        businessId: String(alert.businessId),
        businessName: String(alert.businessName || "Business"),
        type: String(alert.type || ""),
        severity: alert.severity,
        status: alert.status,
        lastSeenAt: alert.lastSeenAt || null,
        meta: alert.meta || null,
      })),
      messageEs,
    });
  } catch (error: unknown) {
    const err = error as ApiError;
    const status = err.status || 500;
    logRequest(req, {
      route: "admin.finance.digest",
      status,
      durationMs: Date.now() - startedAt,
      extra: {
        message: err.message || "Could not build finance digest.",
      },
    });
    return fail(
      err.code || "SERVER_ERROR",
      err.message || "Could not build finance digest.",
      status
    );
  }
}
