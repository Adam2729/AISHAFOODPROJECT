import { ok, fail } from "@/lib/apiResponse";
import { requireAdminKey } from "@/lib/adminAuth";
import { logRequest } from "@/lib/logger";
import { runPiiRedactionJob } from "@/lib/piiRedactionJob";

type ApiError = Error & { status?: number; code?: string };

function isAuthorizedCronRequest(req: Request) {
  const secret = String(process.env.CRON_SECRET || "").trim();
  if (!secret) return { ok: false, reason: "CRON_SECRET is missing in env.", status: 500 };

  const authHeader = String(req.headers.get("authorization") || "").trim();
  const bearer = authHeader.toLowerCase().startsWith("bearer ")
    ? authHeader.slice(7).trim()
    : "";
  const headerSecret = String(req.headers.get("x-cron-secret") || "").trim();
  const token = bearer || headerSecret;
  if (!token || token !== secret) {
    return { ok: false, reason: "Unauthorized cron request.", status: 401 };
  }
  return { ok: true, reason: "", status: 200 };
}

function resolveRetentionDays(req: Request) {
  const raw = new URL(req.url).searchParams.get("retentionDays");
  if (raw == null) return undefined;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return undefined;
  return parsed;
}

export async function GET(req: Request) {
  const startedAt = Date.now();
  try {
    const auth = isAuthorizedCronRequest(req);
    if (!auth.ok) return fail("UNAUTHORIZED", auth.reason, auth.status);

    const payload = await runPiiRedactionJob({
      retentionDaysOverride: resolveRetentionDays(req),
      actor: "cron",
    });
    logRequest(req, {
      route: "admin.jobs.pii-redact",
      status: 200,
      durationMs: Date.now() - startedAt,
      extra: {
        retentionDays: payload.retentionDays,
        ordersRedacted: payload.ordersRedacted,
        complaintsRedacted: payload.complaintsRedacted,
      },
    });
    return ok(payload);
  } catch (error: unknown) {
    const err = error as ApiError;
    const status = err.status || 500;
    logRequest(req, {
      route: "admin.jobs.pii-redact",
      status,
      durationMs: Date.now() - startedAt,
      extra: { message: err.message || "Could not run pii redaction job." },
    });
    return fail(
      err.code || "SERVER_ERROR",
      err.message || "Could not run pii redaction job.",
      status
    );
  }
}

export async function POST(req: Request) {
  const startedAt = Date.now();
  try {
    requireAdminKey(req);
    const payload = await runPiiRedactionJob({
      retentionDaysOverride: resolveRetentionDays(req),
      actor: "admin",
    });
    logRequest(req, {
      route: "admin.jobs.pii-redact",
      status: 200,
      durationMs: Date.now() - startedAt,
      extra: {
        retentionDays: payload.retentionDays,
        ordersRedacted: payload.ordersRedacted,
        complaintsRedacted: payload.complaintsRedacted,
      },
    });
    return ok(payload);
  } catch (error: unknown) {
    const err = error as ApiError;
    const status = err.status || 500;
    logRequest(req, {
      route: "admin.jobs.pii-redact",
      status,
      durationMs: Date.now() - startedAt,
      extra: { message: err.message || "Could not run pii redaction job." },
    });
    return fail(
      err.code || "SERVER_ERROR",
      err.message || "Could not run pii redaction job.",
      status
    );
  }
}

