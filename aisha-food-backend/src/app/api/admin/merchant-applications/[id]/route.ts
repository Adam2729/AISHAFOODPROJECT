import mongoose from "mongoose";
import { dbConnect } from "@/lib/mongodb";
import { ok, fail } from "@/lib/apiResponse";
import { assertNotInMaintenance } from "@/lib/maintenance";
import { requireAdminKey } from "@/lib/adminAuth";
import { MerchantApplication } from "@/models/MerchantApplication";

type ApiError = Error & { status?: number; code?: string };

export async function GET(
  req: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    requireAdminKey(req);
    await assertNotInMaintenance();
    await dbConnect();

    const { id } = await context.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return fail("VALIDATION_ERROR", "Valid application id is required.", 400);
    }

    const row = await MerchantApplication.findById(id).lean();
    if (!row) return fail("NOT_FOUND", "Application not found.", 404);

    return ok({
      application: {
        _id: String(row._id),
        cityId: String(row.cityId),
        businessName: row.businessName,
        ownerName: row.ownerName,
        phone: row.phone,
        whatsapp: String(row.whatsapp || ""),
        address: String(row.address || ""),
        cuisineType: String(row.cuisineType || ""),
        notes: String(row.notes || ""),
        status: row.status,
        createdAt: row.createdAt || null,
        approvedAt: row.approvedAt || null,
        rejectedAt: row.rejectedAt || null,
        createdBusinessId: row.createdBusinessId ? String(row.createdBusinessId) : null,
      },
    });
  } catch (error: unknown) {
    const err = error as ApiError;
    return fail(err.code || "SERVER_ERROR", err.message || "Could not load application.", err.status || 500);
  }
}
