import mongoose from "mongoose";
import { dbConnect } from "@/lib/mongodb";
import { ok, fail, readJson } from "@/lib/apiResponse";
import { requireAdminKey } from "@/lib/adminAuth";
import { Business } from "@/models/Business";
import { BusinessAudit } from "@/models/BusinessAudit";

type ApiError = Error & { status?: number; code?: string };

type Body = {
  businessId?: string;
};

export async function POST(req: Request) {
  try {
    requireAdminKey(req);
    const body = await readJson<Body>(req);
    const businessId = String(body.businessId || "").trim();
    if (!mongoose.Types.ObjectId.isValid(businessId)) {
      return fail("VALIDATION_ERROR", "Invalid businessId.", 400);
    }

    await dbConnect();
    const now = new Date();
    const updated = await Business.findByIdAndUpdate(
      new mongoose.Types.ObjectId(businessId),
      {
        $set: {
          "health.cancelsCount30d": 0,
          "health.slowAcceptCount30d": 0,
          "health.lastHealthUpdateAt": now,
          "health.lastHealthResetAt": now,
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
        action: "HEALTH_RESET",
        meta: { resetAt: now.toISOString() },
      });
    } catch (auditError: unknown) {
      console.error(
        JSON.stringify({
          type: "business_audit_write_error",
          route: "admin.businesses.health-reset",
          businessId,
          action: "HEALTH_RESET",
          error: auditError instanceof Error ? auditError.message : "Failed to write business audit event",
          timestamp: new Date().toISOString(),
        })
      );
    }

    return ok({
      businessId,
      resetAt: now.toISOString(),
    });
  } catch (e: unknown) {
    const err = e as ApiError;
    return fail(err.code || "SERVER_ERROR", err.message || "Could not reset health counters.", err.status || 500);
  }
}

