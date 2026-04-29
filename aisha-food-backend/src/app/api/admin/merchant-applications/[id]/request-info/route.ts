import mongoose from "mongoose";
import { dbConnect } from "@/lib/mongodb";
import { ok, fail, readJson } from "@/lib/apiResponse";
import { assertNotInMaintenance } from "@/lib/maintenance";
import { requireAdminKey } from "@/lib/adminAuth";
import { MerchantApplication } from "@/models/MerchantApplication";

type ApiError = Error & { status?: number; code?: string };

type Body = {
  note?: string;
};

const ADMIN_ACTOR = "admin_key";

export async function POST(
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

    const body = await readJson<Body>(req);
    const note = String(body.note || "").trim().slice(0, 400);
    if (!note) {
      return fail("VALIDATION_ERROR", "note is required.", 400);
    }

    const application = await MerchantApplication.findById(id).lean();
    if (!application) return fail("NOT_FOUND", "Application not found.", 404);
    if (application.status === "approved") {
      return fail("INVALID_STATE", "Approved applications cannot be moved to needs_info.", 409);
    }
    if (application.status === "rejected") {
      return fail("INVALID_STATE", "Rejected applications cannot be moved to needs_info.", 409);
    }

    await MerchantApplication.updateOne(
      { _id: application._id },
      {
        $set: {
          status: "needs_info",
          notes: note,
          rejectedByAdminId: ADMIN_ACTOR,
        },
      }
    );

    return ok({
      applicationId: String(application._id),
      status: "needs_info",
    });
  } catch (error: unknown) {
    const err = error as ApiError;
    return fail(
      err.code || "SERVER_ERROR",
      err.message || "Could not request more information.",
      err.status || 500
    );
  }
}
