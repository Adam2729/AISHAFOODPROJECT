import { ok, fail, readJson } from "@/lib/apiResponse";
import { requireAdminKey } from "@/lib/adminAuth";
import { setNumberSetting } from "@/lib/appSettings";

type ApiError = Error & { status?: number; code?: string };

type Body = {
  key?: unknown;
  value?: unknown;
};

const ALLOWED_NUMBER_KEYS = new Set([
  "sla_slow_accept_threshold",
  "sla_cancel_threshold",
  "promo_budget_weekly_rdp",
  "min_products_required",
  "menu_quality_min_score",
  "menu_quality_pause_threshold",
  "auto_hide_days",
  "finance_diff_orders_threshold",
  "finance_diff_money_threshold_rdp",
  "finance_stale_submission_hours",
  "finance_digest_hour_utc",
]);

export async function POST(req: Request) {
  try {
    requireAdminKey(req);
    const body = await readJson<Body>(req);
    const key = String(body.key || "").trim();
    if (!ALLOWED_NUMBER_KEYS.has(key)) {
      return fail("VALIDATION_ERROR", "Invalid key.", 400);
    }
    if (typeof body.value !== "number" || !Number.isFinite(body.value)) {
      return fail("VALIDATION_ERROR", "value number is required.", 400);
    }

    let value = Math.floor(body.value);
    if (key === "promo_budget_weekly_rdp") {
      value = Math.max(0, Math.min(100000000, value));
    } else if (key === "min_products_required") {
      value = Math.max(1, Math.min(500, value));
    } else if (key === "menu_quality_min_score" || key === "menu_quality_pause_threshold") {
      value = Math.max(0, Math.min(100, value));
    } else if (key === "auto_hide_days") {
      value = Math.max(1, Math.min(365, value));
    } else if (key === "finance_diff_orders_threshold") {
      value = Math.max(0, Math.min(5000, value));
    } else if (key === "finance_diff_money_threshold_rdp") {
      value = Math.max(0, Math.min(100000000, value));
    } else if (key === "finance_stale_submission_hours") {
      value = Math.max(1, Math.min(720, value));
    } else if (key === "finance_digest_hour_utc") {
      value = Math.max(0, Math.min(23, value));
    } else {
      value = Math.max(1, Math.min(1000, value));
    }
    const updated = await setNumberSetting(key, value);
    return ok({ key, value: updated });
  } catch (e: unknown) {
    const err = e as ApiError;
    return fail(
      err.code || "SERVER_ERROR",
      err.message || "Could not update number setting.",
      err.status || 500
    );
  }
}
