import { ok, fail } from "@/lib/apiResponse";
import { requireAdminKey } from "@/lib/adminAuth";
import { runPerformanceRecompute } from "@/lib/performanceJob";

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

export async function GET(req: Request) {
  try {
    const auth = isAuthorizedCronRequest(req);
    if (!auth.ok) return fail("UNAUTHORIZED", auth.reason, auth.status);

    const result = await runPerformanceRecompute();
    return ok({
      ran: true,
      ...result,
    });
  } catch (e: unknown) {
    const err = e as ApiError;
    return fail(
      err.code || "SERVER_ERROR",
      err.message || "Could not recompute merchant performance.",
      err.status || 500
    );
  }
}

export async function POST(req: Request) {
  try {
    requireAdminKey(req);
    const result = await runPerformanceRecompute();
    return ok({
      ran: true,
      ...result,
    });
  } catch (e: unknown) {
    const err = e as ApiError;
    return fail(
      err.code || "SERVER_ERROR",
      err.message || "Could not recompute merchant performance.",
      err.status || 500
    );
  }
}
