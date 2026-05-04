import { ok, fail, readJson } from "@/lib/apiResponse";
import { requireAdminKey } from "@/lib/adminAuth";
import { getMaintenanceSetting, setMaintenanceMode } from "@/lib/maintenance";

type ApiError = Error & { status?: number; code?: string };

type Body = {
  enabled?: unknown;
};

export async function GET(req: Request) {
  try {
    requireAdminKey(req);
    const setting = await getMaintenanceSetting();
    return ok({
      maintenanceMode: setting.maintenanceMode,
      source: setting.source,
    });
  } catch (e: unknown) {
    const err = e as ApiError;
    return fail(err.code || "SERVER_ERROR", err.message || "Could not load maintenance mode.", err.status || 500);
  }
}

export async function POST(req: Request) {
  try {
    requireAdminKey(req);
    const rawBody = await readJson<unknown>(req);
    if (!rawBody || typeof rawBody !== "object" || Array.isArray(rawBody)) {
      return fail("VALIDATION_ERROR", "enabled boolean is required.", 400);
    }
    const body = rawBody as Body;
    if (typeof body.enabled !== "boolean") {
      return fail("VALIDATION_ERROR", "enabled boolean is required.", 400);
    }

    const updated = await setMaintenanceMode(body.enabled);
    return ok({
      maintenanceMode: updated.maintenanceMode,
    });
  } catch (e: unknown) {
    const err = e as ApiError;
    return fail(err.code || "SERVER_ERROR", err.message || "Could not update maintenance mode.", err.status || 500);
  }
}
