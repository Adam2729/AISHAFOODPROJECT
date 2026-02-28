import { ok, fail } from "@/lib/apiResponse";
import { requireAdminKey } from "@/lib/adminAuth";
import { getWeekKey } from "@/lib/geo";
import { logRequest } from "@/lib/logger";
import { getBoolSetting, getNumberSetting } from "@/lib/appSettings";
import { computeFinanceAlignmentForWeek } from "@/lib/financeAlignment";
import { evaluateFinanceAnomalies, writeFinanceAnomalyEvents } from "@/lib/financeAnomalies";
import { getUtcDayKey, upsertFinanceAlertsFromOpsEvents } from "@/lib/financeAlerts";

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

function resolveDayKey(req: Request) {
  const raw = new URL(req.url).searchParams.get("dayKey");
  const parsed = String(raw || "").trim();
  return parsed || getUtcDayKey(new Date());
}

async function runJob(weekKey: string, dayKey: string) {
  const staleSubmissionHours = Math.max(
    1,
    Math.round(Number(await getNumberSetting("finance_stale_submission_hours", 24)))
  );

  const alignment = await computeFinanceAlignmentForWeek(weekKey, { limit: 5000 });
  const events = evaluateFinanceAnomalies(alignment.rows, {
    weekKey,
    staleSubmissionHours,
  });
  const writeResult = await writeFinanceAnomalyEvents(weekKey, events);
  const alertsResult = await upsertFinanceAlertsFromOpsEvents(weekKey, dayKey);

  return {
    ran: true,
    weekKey,
    dayKey,
    rowsTotal: alignment.summary.totalRows,
    eventsEvaluated: events.length,
    eventsInserted: writeResult.inserted,
    eventsSkipped: writeResult.skipped,
    alertsUpserted: alertsResult.upserted,
    alertsTouched: alertsResult.touched,
    alertsSkipped: alertsResult.skipped,
    timestamp: new Date().toISOString(),
  };
}

export async function GET(req: Request) {
  const startedAt = Date.now();
  try {
    const auth = isAuthorizedCronRequest(req);
    if (!auth.ok) return fail("UNAUTHORIZED", auth.reason, auth.status);

    const digestEnabled = await getBoolSetting("finance_digest_daily_enabled", true);
    if (!digestEnabled) {
      return ok({
        skipped: true,
        reason: "digest_disabled",
        weekKey: resolveWeekKey(req),
        dayKey: resolveDayKey(req),
      });
    }

    const configuredHour = Math.max(
      0,
      Math.min(23, Math.round(Number(await getNumberSetting("finance_digest_hour_utc", 13))))
    );
    const nowHour = new Date().getUTCHours();
    if (nowHour !== configuredHour) {
      return ok({
        skipped: true,
        reason: "hour_mismatch",
        expectedHourUtc: configuredHour,
        currentHourUtc: nowHour,
        weekKey: resolveWeekKey(req),
        dayKey: resolveDayKey(req),
      });
    }

    const payload = await runJob(resolveWeekKey(req), resolveDayKey(req));
    logRequest(req, {
      route: "admin.jobs.finance-alerts",
      status: 200,
      durationMs: Date.now() - startedAt,
      extra: {
        weekKey: payload.weekKey,
        dayKey: payload.dayKey,
        alertsUpserted: payload.alertsUpserted,
      },
    });
    return ok(payload);
  } catch (error: unknown) {
    const err = error as ApiError;
    const status = err.status || 500;
    logRequest(req, {
      route: "admin.jobs.finance-alerts",
      status,
      durationMs: Date.now() - startedAt,
      extra: {
        message: err.message || "Could not run finance alerts job.",
      },
    });
    return fail(
      err.code || "SERVER_ERROR",
      err.message || "Could not run finance alerts job.",
      status
    );
  }
}

export async function POST(req: Request) {
  const startedAt = Date.now();
  try {
    requireAdminKey(req);
    const payload = await runJob(resolveWeekKey(req), resolveDayKey(req));
    logRequest(req, {
      route: "admin.jobs.finance-alerts",
      status: 200,
      durationMs: Date.now() - startedAt,
      extra: {
        weekKey: payload.weekKey,
        dayKey: payload.dayKey,
        alertsUpserted: payload.alertsUpserted,
      },
    });
    return ok(payload);
  } catch (error: unknown) {
    const err = error as ApiError;
    const status = err.status || 500;
    logRequest(req, {
      route: "admin.jobs.finance-alerts",
      status,
      durationMs: Date.now() - startedAt,
      extra: {
        message: err.message || "Could not run finance alerts job.",
      },
    });
    return fail(
      err.code || "SERVER_ERROR",
      err.message || "Could not run finance alerts job.",
      status
    );
  }
}
