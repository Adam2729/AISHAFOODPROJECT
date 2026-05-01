import mongoose from "mongoose";
import { dbConnect } from "@/lib/mongodb";
import { ok, fail, readJson } from "@/lib/apiResponse";
import { assertNotInMaintenance } from "@/lib/maintenance";
import { requireAdminKey } from "@/lib/adminAuth";
import { DriverApplication } from "@/models/DriverApplication";

type ApiError = Error & { status?: number; code?: string };

type Body = { reason?: string };

export async function POST(req: Request, context: { params: Promise<{ id: string }> }) {
  try {
    requireAdminKey(req);
    await assertNotInMaintenance();
    await dbConnect();

    const { id } = await context.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return fail("VALIDATION_ERROR", "Valid application id is required.", 400);
    }

    const body = (await readJson<Body>(req)) || {};
    const reasonRaw = String(body.reason || "").trim().slice(0, 280);
    if (!reasonRaw) {
      return fail("VALIDATION_ERROR", "reason is required.", 400);
    }

    const application = await DriverApplication.findById(id).lean();
    if (!application) return fail("NOT_FOUND", "Application not found.", 404);

    if (application.status === "rejected") {
      return ok({ applicationId: String(application._id), status: "rejected", idempotent: true });
    }
    if (application.status === "approved") {
      return fail("INVALID_STATE", "Application already approved.", 409);
    }

    await DriverApplication.updateOne(
      { _id: application._id, status: "pending" },
      {
        $set: {
          status: "rejected",
          reviewedAt: new Date(),
          reviewedBy: "admin_key",
          reviewedByAdminId: null,
          rejectReason: reasonRaw,
          rejectionReason: reasonRaw,
        },
      }
    );

    return ok({ applicationId: String(application._id), status: "rejected" });
  } catch (error: unknown) {
    const err = error as ApiError;
    return fail(err.code || "SERVER_ERROR", err.message || "Could not reject driver application.", err.status || 500);
  }
}
