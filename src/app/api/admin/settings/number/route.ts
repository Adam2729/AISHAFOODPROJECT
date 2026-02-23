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

    const value = Math.max(1, Math.min(1000, Math.floor(body.value)));
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
