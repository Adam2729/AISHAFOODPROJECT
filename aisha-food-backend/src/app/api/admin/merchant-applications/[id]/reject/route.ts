import mongoose from "mongoose";
import { dbConnect } from "@/lib/mongodb";
import { ok, fail, readJson } from "@/lib/apiResponse";
import { assertNotInMaintenance } from "@/lib/maintenance";
import { requireAdminKey } from "@/lib/adminAuth";
import { MerchantApplication } from "@/models/MerchantApplication";

type ApiError = Error & { status?: number; code?: string };

type Body = {
  reason?: string;
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
    const reason = String(body.reason || "").trim().slice(0, 400);

    const application = await MerchantApplication.findById(id).lean();
    if (!application) return fail("NOT_FOUND", "Application not found.", 404);

    if (application.status === "rejected") {
      return ok({ applicationId: String(application._id), idempotent: true });
    }
    if (application.status === "approved") {
      return fail("INVALID_STATE", "Application already approved.", 409);
    }

    await MerchantApplication.updateOne(
      { _id: application._id, status: { $in: ["pending", "needs_info"] } },
      {
        $set: {
          status: "rejected",
          rejectedAt: new Date(),
          rejectedByAdminId: ADMIN_ACTOR,
          notes: reason,
        },
      }
    );

    return ok({ applicationId: String(application._id) });
  } catch (error: unknown) {
    const err = error as ApiError;
    return fail(err.code || "SERVER_ERROR", err.message || "Could not reject application.", err.status || 500);
  }
}
