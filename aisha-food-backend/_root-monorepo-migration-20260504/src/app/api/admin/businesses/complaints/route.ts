import mongoose from "mongoose";
import { dbConnect } from "@/lib/mongodb";
import { ok, fail, readJson } from "@/lib/apiResponse";
import { requireAdminKey } from "@/lib/adminAuth";
import { Business } from "@/models/Business";
import { BusinessAudit } from "@/models/BusinessAudit";

type ApiError = Error & { status?: number; code?: string };

type Body = {
  businessId?: string;
  complaintsCount?: unknown;
};

export async function POST(req: Request) {
  try {
    requireAdminKey(req);
    const body = await readJson<Body>(req);
    const businessId = String(body.businessId || "").trim();
    const complaintsCount = Number(body.complaintsCount);

    if (!mongoose.Types.ObjectId.isValid(businessId)) {
      return fail("VALIDATION_ERROR", "Invalid businessId.", 400);
    }
    if (!Number.isInteger(complaintsCount) || complaintsCount < 0 || complaintsCount > 999) {
      return fail("VALIDATION_ERROR", "complaintsCount must be an integer between 0 and 999.", 400);
    }

    await dbConnect();
    const updated = await Business.findByIdAndUpdate(
      new mongoose.Types.ObjectId(businessId),
      {
        $set: {
          "health.complaintsCount": complaintsCount,
          "health.lastHealthUpdateAt": new Date(),
        },
      },
      { returnDocument: "after" }
    ).lean();

    if (!updated) {
      return fail("NOT_FOUND", "Business not found.", 404);
    }

    try {
      await BusinessAudit.create({
        businessId: new mongoose.Types.ObjectId(businessId),
        action: "COMPLAINTS_SET",
        meta: { complaintsCount },
      });
    } catch (auditError: unknown) {
      console.error(
        JSON.stringify({
          type: "business_audit_write_error",
          route: "admin.businesses.complaints",
          businessId,
          action: "COMPLAINTS_SET",
          error: auditError instanceof Error ? auditError.message : "Failed to write business audit event",
          timestamp: new Date().toISOString(),
        })
      );
    }

    return ok({
      businessId,
      complaintsCount,
    });
  } catch (e: unknown) {
    const err = e as ApiError;
    return fail(err.code || "SERVER_ERROR", err.message || "Could not update complaints count.", err.status || 500);
  }
}

