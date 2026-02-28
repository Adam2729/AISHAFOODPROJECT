import mongoose from "mongoose";
import { dbConnect } from "@/lib/mongodb";
import { ok, fail, readJson } from "@/lib/apiResponse";
import { requireAdminKey } from "@/lib/adminAuth";
import { Business } from "@/models/Business";
import { BusinessAudit } from "@/models/BusinessAudit";

type ApiError = Error & { status?: number; code?: string };

type Body = {
  businessId?: string;
  paused?: unknown;
  reason?: unknown;
};

function isValidBusinessId(id: string) {
  return mongoose.Types.ObjectId.isValid(id);
}

export async function GET(req: Request) {
  try {
    requireAdminKey(req);
    const url = new URL(req.url);
    const businessId = String(url.searchParams.get("businessId") || "").trim();
    if (!isValidBusinessId(businessId)) {
      return fail("VALIDATION_ERROR", "Invalid businessId.", 400);
    }

    await dbConnect();
    const business = await Business.findById(new mongoose.Types.ObjectId(businessId))
      .select("paused pausedReason pausedAt health performance")
      .lean();
    if (!business) {
      return fail("NOT_FOUND", "Business not found.", 404);
    }

    return ok({
      businessId,
      paused: Boolean((business as { paused?: boolean }).paused),
      pausedReason: String((business as { pausedReason?: string }).pausedReason || ""),
      pausedAt: (business as { pausedAt?: Date | null }).pausedAt || null,
      health: (business as { health?: Record<string, unknown> }).health || {
        complaintsCount: 0,
        cancelsCount30d: 0,
        slowAcceptCount30d: 0,
        lastHealthUpdateAt: null,
        lastHealthResetAt: null,
      },
      performance: (business as { performance?: Record<string, unknown> }).performance || {
        score: 50,
        tier: "bronze",
        updatedAt: null,
        overrideBoost: 0,
        overrideTier: null,
        note: null,
      },
    });
  } catch (e: unknown) {
    const err = e as ApiError;
    return fail(err.code || "SERVER_ERROR", err.message || "Could not load pause status.", err.status || 500);
  }
}

export async function POST(req: Request) {
  try {
    requireAdminKey(req);
    const body = await readJson<Body>(req);
    const businessId = String(body.businessId || "").trim();
    const paused = body.paused;
    const reasonRaw = typeof body.reason === "string" ? body.reason : "";
    const reason = reasonRaw.trim();

    if (!isValidBusinessId(businessId)) {
      return fail("VALIDATION_ERROR", "Invalid businessId.", 400);
    }
    if (typeof paused !== "boolean") {
      return fail("VALIDATION_ERROR", "paused boolean is required.", 400);
    }
    if (reason.length > 140) {
      return fail("VALIDATION_ERROR", "reason must be 140 characters or less.", 400);
    }

    await dbConnect();
    const pausedAt = paused ? new Date() : null;
    const updated = await Business.findByIdAndUpdate(
      new mongoose.Types.ObjectId(businessId),
      {
        $set: {
          paused,
          pausedReason: paused ? reason : "",
          pausedAt,
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
        action: paused ? "PAUSED" : "UNPAUSED",
        meta: {
          reason: paused ? reason : "",
        },
      });
    } catch (auditError: unknown) {
      console.error(
        JSON.stringify({
          type: "business_audit_write_error",
          route: "admin.businesses.pause",
          businessId,
          action: paused ? "PAUSED" : "UNPAUSED",
          error: auditError instanceof Error ? auditError.message : "Failed to write business audit event",
          timestamp: new Date().toISOString(),
        })
      );
    }

    return ok({
      businessId,
      paused: Boolean((updated as { paused?: boolean }).paused),
      pausedReason: String((updated as { pausedReason?: string }).pausedReason || ""),
      pausedAt: (updated as { pausedAt?: Date | null }).pausedAt || null,
    });
  } catch (e: unknown) {
    const err = e as ApiError;
    return fail(err.code || "SERVER_ERROR", err.message || "Could not update pause status.", err.status || 500);
  }
}
