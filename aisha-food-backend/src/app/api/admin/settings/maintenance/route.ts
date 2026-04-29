import { ok, fail, readJson } from "@/lib/apiResponse";
import { requireAdminKey } from "@/lib/adminAuth";
import { getMaintenanceSetting, setMaintenanceMode } from "@/lib/maintenance";

type ApiError = Error & { status?: number; code?: string };
type Body = {
  maintenanceMode?: boolean;
  value?: boolean;
  enabled?: boolean;
};

function toNullableIso(value: Date | null | undefined) {
  return value ? new Date(value).toISOString() : null;
}

export async function GET(req: Request) {
  try {
    requireAdminKey(req);
    const setting = await getMaintenanceSetting();
    return ok({
      maintenanceMode: setting.maintenanceMode,
      updatedAt: toNullableIso(setting.updatedAt),
    });
  } catch (e: unknown) {
    const err = e as ApiError;
    return fail(err.code || "SERVER_ERROR", err.message || "Could not load maintenance setting.", err.status || 500);
  }
}

export async function POST(req: Request) {
  try {
    requireAdminKey(req);
    const body = await readJson<Body>(req);
    const raw = body.maintenanceMode ?? body.value ?? body.enabled;
    if (typeof raw !== "boolean") {
      return fail("VALIDATION_ERROR", "maintenanceMode boolean is required.", 400);
    }

    const updated = await setMaintenanceMode(raw);
    return ok({
      maintenanceMode: updated.maintenanceMode,
      updatedAt: toNullableIso(updated.updatedAt),
    });
  } catch (e: unknown) {
    const err = e as ApiError;
    return fail(err.code || "SERVER_ERROR", err.message || "Could not update maintenance setting.", err.status || 500);
  }
}
