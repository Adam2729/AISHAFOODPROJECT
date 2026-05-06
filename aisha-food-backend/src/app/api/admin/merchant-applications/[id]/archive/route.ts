import mongoose from "mongoose";
import { ok, fail, readJson } from "@/lib/apiResponse";
import { requireAdminKey } from "@/lib/adminAuth";
import { assertNotInMaintenance } from "@/lib/maintenance";
import { dbConnect } from "@/lib/mongodb";
import { MerchantApplication } from "@/models/MerchantApplication";

type ApiError = Error & { status?: number; code?: string };

type Params = {
  params: Promise<{ id: string }>;
};

type ArchiveBody = {
  reason?: string;
};

export async function POST(req: Request, { params }: Params) {
  try {
    requireAdminKey(req);
    await assertNotInMaintenance();
    const { id } = await params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return fail("VALIDATION_ERROR", "Application id must be valid.", 400);
    }

    const body = await readJson<ArchiveBody>(req).catch(() => ({} as ArchiveBody));
    const reason = String(body.reason || "").trim().slice(0, 400);
    if (reason.length < 5) {
      return fail("VALIDATION_ERROR", "Archive reason must be at least 5 characters.", 400);
    }

    await dbConnect();

    const current = await MerchantApplication.findById(id)
      .select("_id isArchived")
      .lean<{ _id: mongoose.Types.ObjectId; isArchived?: boolean } | null>();
    if (!current) {
      return fail("NOT_FOUND", "Merchant application not found.", 404);
    }
    if (current.isArchived) {
      return ok({ archived: true, applicationId: String(current._id) });
    }

    await MerchantApplication.updateOne(
      { _id: current._id },
      {
        $set: {
          isArchived: true,
          archivedAt: new Date(),
          archivedByAdminId: "admin_key",
          archiveReason: reason,
        },
      }
    );

    return ok({
      archived: true,
      applicationId: String(current._id),
    });
  } catch (error: unknown) {
    const err = error as ApiError;
    return fail(
      err.code || "SERVER_ERROR",
      err.message || "Could not archive merchant application.",
      err.status || 500
    );
  }
}
