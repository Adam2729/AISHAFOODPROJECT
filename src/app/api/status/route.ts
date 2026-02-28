import { ok, fail } from "@/lib/apiResponse";
import { isMaintenanceMode } from "@/lib/maintenance";
import { getBoolSetting } from "@/lib/appSettings";

type ApiError = Error & { status?: number; code?: string };

export async function GET() {
  try {
    const [maintenance, promosEnabled, pilotModeEnabled] = await Promise.all([
      isMaintenanceMode(),
      getBoolSetting("promos_enabled", true),
      getBoolSetting("pilot_mode", false),
    ]);

    return ok({
      env: process.env.NODE_ENV || "development",
      timestamp: new Date().toISOString(),
      maintenance,
      promosEnabled,
      pilotModeEnabled,
      version: String(process.env.VERCEL_GIT_COMMIT_SHA || "").trim() || null,
    });
  } catch (error: unknown) {
    const err = error as ApiError;
    return fail(err.code || "SERVER_ERROR", err.message || "Could not load status.", err.status || 500);
  }
}
