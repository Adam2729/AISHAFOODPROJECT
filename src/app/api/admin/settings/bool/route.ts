import { ok, fail, readJson } from "@/lib/apiResponse";
import { requireAdminKey } from "@/lib/adminAuth";
import { setBoolSetting } from "@/lib/appSettings";

type ApiError = Error & { status?: number; code?: string };

type Body = {
  key?: unknown;
  value?: unknown;
};

const ALLOWED_BOOL_KEYS = new Set([
  "pilot_mode",
  "pilot_allowlist_enabled",
  "sla_auto_pause_enabled",
]);

export async function POST(req: Request) {
  try {
    requireAdminKey(req);
    const body = await readJson<Body>(req);
    const key = String(body.key || "").trim();
    if (!ALLOWED_BOOL_KEYS.has(key)) {
      return fail("VALIDATION_ERROR", "Invalid key.", 400);
    }
    if (typeof body.value !== "boolean") {
      return fail("VALIDATION_ERROR", "value boolean is required.", 400);
    }

    const value = await setBoolSetting(key, body.value);
    return ok({ key, value });
  } catch (e: unknown) {
    const err = e as ApiError;
    return fail(
      err.code || "SERVER_ERROR",
      err.message || "Could not update boolean setting.",
      err.status || 500
    );
  }
}
