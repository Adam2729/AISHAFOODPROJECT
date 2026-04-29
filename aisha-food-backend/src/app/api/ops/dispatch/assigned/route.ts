import { ok, fail } from "@/lib/apiResponse";
import { requireAdminKey } from "@/lib/adminAuth";
import {
  fetchDispatchQueue,
  parseDispatchStatusFilter,
  parseIntegerParam,
  resolveDispatchSelectedCity,
} from "@/lib/dispatchControl";
import { cityCode } from "@/lib/city";
import { assertNotInMaintenance } from "@/lib/maintenance";

type ApiError = Error & { status?: number; code?: string };

export async function GET(req: Request) {
  try {
    requireAdminKey(req);
    await assertNotInMaintenance();

    const url = new URL(req.url);
    const selectedCity = await resolveDispatchSelectedCity(req, url.searchParams.get("cityId"));
    const statusFilter = parseDispatchStatusFilter(url.searchParams.get("status"));
    const limit = parseIntegerParam(url.searchParams.get("limit"), {
      defaultValue: 50,
      min: 1,
      max: 200,
      label: "limit",
    });
    const skip = parseIntegerParam(url.searchParams.get("skip"), {
      defaultValue: 0,
      min: 0,
      max: 100000,
      label: "skip",
    });

    const { total, rows } = await fetchDispatchQueue({
      cityId: selectedCity._id,
      statusFilter,
      assigned: true,
      limit,
      skip,
    });

    return ok({
      cityId: String(selectedCity._id),
      cityCode: cityCode(selectedCity),
      total,
      rows,
    });
  } catch (error: unknown) {
    const err = error as ApiError;
    return fail(
      err.code || "SERVER_ERROR",
      err.message || "Could not load assigned dispatch orders.",
      err.status || 500
    );
  }
}
