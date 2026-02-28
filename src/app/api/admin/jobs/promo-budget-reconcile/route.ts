import { ok, fail } from "@/lib/apiResponse";
import { requireAdminKey } from "@/lib/adminAuth";
import { getWeekKey } from "@/lib/geo";
import { getPromoPolicyForWeek } from "@/lib/promoBudget";
import { setNumberSetting, setStringSetting } from "@/lib/appSettings";

type ApiError = Error & { status?: number; code?: string };

function resolveWeekKey(req: Request) {
  const raw = new URL(req.url).searchParams.get("weekKey");
  return String(raw || "").trim() || getWeekKey(new Date());
}

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

async function runReconcile(weekKey: string) {
  const policy = await getPromoPolicyForWeek(weekKey);
  const reconciledAt = new Date().toISOString();

  // Optional cache snapshot for faster dashboard reads / ops history
  await Promise.all([
    setStringSetting("promo_budget_reconcile_week_key", weekKey),
    setStringSetting("promo_budget_reconcile_at", reconciledAt),
    setNumberSetting("promo_budget_reconcile_spent_rdp", Number(policy.spentRdp || 0)),
    setNumberSetting("promo_budget_reconcile_remaining_rdp", Number(policy.remainingRdp || 0)),
  ]);

  return {
    weekKey,
    promosEnabled: policy.promosEnabled,
    weeklyBudgetRdp: policy.weeklyBudgetRdp,
    spentRdp: policy.spentRdp,
    remainingRdp: policy.remainingRdp,
    reconciledAt,
  };
}

export async function GET(req: Request) {
  try {
    const auth = isAuthorizedCronRequest(req);
    if (!auth.ok) return fail("UNAUTHORIZED", auth.reason, auth.status);

    const weekKey = resolveWeekKey(req);
    const result = await runReconcile(weekKey);
    return ok({
      ran: true,
      ...result,
    });
  } catch (e: unknown) {
    const err = e as ApiError;
    return fail(
      err.code || "SERVER_ERROR",
      err.message || "Could not reconcile promo budget.",
      err.status || 500
    );
  }
}

export async function POST(req: Request) {
  try {
    requireAdminKey(req);
    const weekKey = resolveWeekKey(req);
    const result = await runReconcile(weekKey);
    return ok({
      ran: true,
      ...result,
    });
  } catch (e: unknown) {
    const err = e as ApiError;
    return fail(
      err.code || "SERVER_ERROR",
      err.message || "Could not reconcile promo budget.",
      err.status || 500
    );
  }
}

