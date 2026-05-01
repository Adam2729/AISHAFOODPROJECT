import mongoose from "mongoose";
import { dbConnect } from "@/lib/mongodb";
import { ok, fail } from "@/lib/apiResponse";
import { assertNotInMaintenance } from "@/lib/maintenance";
import { requireAdminKey } from "@/lib/adminAuth";
import { maskPhone } from "@/lib/pii";
import { DriverApplication } from "@/models/DriverApplication";

type ApiError = Error & { status?: number; code?: string };

export async function GET(req: Request) {
  try {
    requireAdminKey(req);
    await assertNotInMaintenance();
    await dbConnect();

    const url = new URL(req.url);
    const cityId = url.searchParams.get("cityId");
    const status = url.searchParams.get("status") || "pending";
    const limit = Math.max(1, Math.min(200, Number(url.searchParams.get("limit") || 50)));
    const skip = Math.max(0, Number(url.searchParams.get("skip") || 0));

    if (!cityId || !mongoose.Types.ObjectId.isValid(cityId)) {
      return fail("VALIDATION_ERROR", "cityId is required and must be valid.", 400);
    }
    if (!["pending", "approved", "rejected", "all"].includes(status)) {
      return fail("VALIDATION_ERROR", "Invalid status.", 400);
    }

    const filter: Record<string, unknown> = {
      cityId: new mongoose.Types.ObjectId(cityId),
    };
    if (status !== "all") {
      filter.status = status;
    }

    const [rows, total] = await Promise.all([
      DriverApplication.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      DriverApplication.countDocuments(filter),
    ]);

    return ok({
      cityId,
      status,
      total,
      rows: rows.map((row) => ({
        applicationId: String(row._id),
        fullName: row.fullName || row.name,
        name: row.fullName || row.name,
        phoneMasked: maskPhone(String(row.phone || "").trim()),
        hasPhone: Boolean(String(row.phone || "").trim()),
        email: row.email || null,
        city: row.city || null,
        zoneLabel: row.zoneLabel || null,
        vehicleType: row.vehicleType || null,
        availability: row.availability || null,
        notes: row.notes || null,
        createdAt: row.createdAt || null,
        status: row.status,
        reviewedAt: row.reviewedAt || null,
        reviewedBy: row.reviewedBy || null,
        rejectionReason: row.rejectionReason || row.rejectReason || null,
        rejectReason: row.rejectionReason || row.rejectReason || null,
        approvedDriverId: row.approvedDriverId
          ? String(row.approvedDriverId)
          : row.driverId
            ? String(row.driverId)
            : null,
        driverId: row.approvedDriverId
          ? String(row.approvedDriverId)
          : row.driverId
            ? String(row.driverId)
            : null,
      })),
    });
  } catch (error: unknown) {
    const err = error as ApiError;
    return fail(
      err.code || "SERVER_ERROR",
      err.message || "Could not list driver applications.",
      err.status || 500
    );
  }
}
