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
      assigned: false,
      limit,
      skip,
    });

    return ok({
      cityId: String(selectedCity._id),
      cityCode: cityCode(selectedCity),
      total,
      rows: rows.map((row) => ({
        orderId: row.orderId,
        orderNumber: row.orderNumber,
        businessId: row.businessId,
        businessName: row.businessName,
        customerName: row.customerName,
        phone: row.phone,
        address: row.address,
        status: row.status,
        driverDispatchStatus: row.driverDispatchStatus,
        currentOfferDriverId: row.currentOfferDriverId,
        offerExpiresAt: row.offerExpiresAt,
        createdAt: row.createdAt,
        deliveryFeeToCustomer: row.deliveryFeeToCustomer,
        total: row.total,
      })),
    });
  } catch (error: unknown) {
    const err = error as ApiError;
    return fail(
      err.code || "SERVER_ERROR",
      err.message || "Could not load unassigned dispatch orders.",
      err.status || 500
    );
  }
}
