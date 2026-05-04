import { ok, fail, readJson } from "@/lib/apiResponse";
import { requireAdminKey } from "@/lib/adminAuth";
import { setStringSetting } from "@/lib/appSettings";

type ApiError = Error & { status?: number; code?: string };

type Body = {
  key?: unknown;
  value?: unknown;
};

const ALLOWED_STRING_KEYS = new Set(["pilot_allowlist_phones"]);

export async function POST(req: Request) {
  try {
    requireAdminKey(req);
    const body = await readJson<Body>(req);
    const key = String(body.key || "").trim();
    if (!ALLOWED_STRING_KEYS.has(key)) {
      return fail("VALIDATION_ERROR", "Invalid key.", 400);
    }
    if (typeof body.value !== "string") {
      return fail("VALIDATION_ERROR", "value string is required.", 400);
    }

    const value = body.value.trim();
    if (value.length > 5000) {
      return fail("VALIDATION_ERROR", "value exceeds maximum length.", 400);
    }

    const updated = await setStringSetting(key, value);
    return ok({ key, value: updated });
  } catch (e: unknown) {
    const err = e as ApiError;
    return fail(
      err.code || "SERVER_ERROR",
      err.message || "Could not update string setting.",
      err.status || 500
    );
  }
}
