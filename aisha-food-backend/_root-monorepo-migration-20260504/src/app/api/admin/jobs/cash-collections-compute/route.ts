import { ok, fail } from "@/lib/apiResponse";
import { requireAdminKey } from "@/lib/adminAuth";
import { getWeekKey } from "@/lib/geo";
import { upsertExpectedCashCollectionsForWeek } from "@/lib/cashCollectionCompute";

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

async function runCompute(weekKey: string) {
  const result = await upsertExpectedCashCollectionsForWeek({ weekKey });
  return {
    ran: true,
    ...result,
    timestamp: new Date().toISOString(),
  };
}

export async function GET(req: Request) {
  try {
    const auth = isAuthorizedCronRequest(req);
    if (!auth.ok) return fail("UNAUTHORIZED", auth.reason, auth.status);
    return ok(await runCompute(resolveWeekKey(req)));
  } catch (error: unknown) {
    const err = error as ApiError;
    return fail(
      err.code || "SERVER_ERROR",
      err.message || "Could not run cash collections compute job.",
      err.status || 500
    );
  }
}

export async function POST(req: Request) {
  try {
    requireAdminKey(req);
    return ok(await runCompute(resolveWeekKey(req)));
  } catch (error: unknown) {
    const err = error as ApiError;
    return fail(
      err.code || "SERVER_ERROR",
      err.message || "Could not run cash collections compute job.",
      err.status || 500
    );
  }
}
