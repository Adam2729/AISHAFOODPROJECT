import { ok, fail } from "@/lib/apiResponse";
import { requireAdminKey } from "@/lib/adminAuth";
import { getWeekKey } from "@/lib/geo";
import { logRequest } from "@/lib/logger";
import { getNumberSetting } from "@/lib/appSettings";
import { computeFinanceAlignmentForWeek } from "@/lib/financeAlignment";
import { evaluateFinanceAnomalies, writeFinanceAnomalyEvents } from "@/lib/financeAnomalies";

type ApiError = Error & { status?: number; code?: string };

function isAuthorizedCronRequest(req: Request) {
  const secret = String(process.env.CRON_SECRET || "").trim();
  if (!secret) return { ok: false, reason: "CRON_SECRET is missing in env.", status: 500 };

  const authHeader = String(req.headers.get("authorization") || "").trim();
  const bearer = authHeader.toLowerCase().startsWith("bearer ") ? authHeader.slice(7).trim() : "";
  const headerSecret = String(req.headers.get("x-cron-secret") || "").trim();
  const token = bearer || headerSecret;
  if (!token || token !== secret) {
    return { ok: false, reason: "Unauthorized cron request.", status: 401 };
  }
  return { ok: true, reason: "", status: 200 };
}

function resolveWeekKey(req: Request) {
  const raw = new URL(req.url).searchParams.get("weekKey");
  const parsed = String(raw || "").trim();
  return parsed || getWeekKey(new Date());
}

async function runJob(weekKey: string) {
  const staleSubmissionHours = Math.max(
    1,
    Math.round(Number(await getNumberSetting("finance_stale_submission_hours", 24)))
  );
  const alignment = await computeFinanceAlignmentForWeek(weekKey, { limit: 5000 });
  const events = evaluateFinanceAnomalies(alignment.rows, { weekKey, staleSubmissionHours });
  const writeResult = await writeFinanceAnomalyEvents(weekKey, events);

  return {
    ran: true,
    weekKey,
    rowsTotal: alignment.summary.totalRows,
    eventsEvaluated: events.length,
    eventsInserted: writeResult.inserted,
    eventsSkipped: writeResult.skipped,
    timestamp: new Date().toISOString(),
  };
}

export async function GET(req: Request) {
  const startedAt = Date.now();
  try {
    const auth = isAuthorizedCronRequest(req);
    if (!auth.ok) return fail("UNAUTHORIZED", auth.reason, auth.status);

    const payload = await runJob(resolveWeekKey(req));
    logRequest(req, {
      route: "admin.jobs.finance-anomalies",
      status: 200,
      durationMs: Date.now() - startedAt,
      extra: {
        weekKey: payload.weekKey,
        rowsTotal: payload.rowsTotal,
        eventsInserted: payload.eventsInserted,
      },
    });
    return ok(payload);
  } catch (error: unknown) {
    const err = error as ApiError;
    const status = err.status || 500;
    logRequest(req, {
      route: "admin.jobs.finance-anomalies",
      status,
      durationMs: Date.now() - startedAt,
      extra: {
        message: err.message || "Could not run finance anomalies job.",
      },
    });
    return fail(
      err.code || "SERVER_ERROR",
      err.message || "Could not run finance anomalies job.",
      status
    );
  }
}

export async function POST(req: Request) {
  const startedAt = Date.now();
  try {
    requireAdminKey(req);
    const payload = await runJob(resolveWeekKey(req));
    logRequest(req, {
      route: "admin.jobs.finance-anomalies",
      status: 200,
      durationMs: Date.now() - startedAt,
      extra: {
        weekKey: payload.weekKey,
        rowsTotal: payload.rowsTotal,
        eventsInserted: payload.eventsInserted,
      },
    });
    return ok(payload);
  } catch (error: unknown) {
    const err = error as ApiError;
    const status = err.status || 500;
    logRequest(req, {
      route: "admin.jobs.finance-anomalies",
      status,
      durationMs: Date.now() - startedAt,
      extra: {
        message: err.message || "Could not run finance anomalies job.",
      },
    });
    return fail(
      err.code || "SERVER_ERROR",
      err.message || "Could not run finance anomalies job.",
      status
    );
  }
}
