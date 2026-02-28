import mongoose from "mongoose";
import { dbConnect } from "@/lib/mongodb";
import { ok, fail, readJson } from "@/lib/apiResponse";
import { requireAdminKey } from "@/lib/adminAuth";
import { Complaint } from "@/models/Complaint";

type ApiError = Error & { status?: number; code?: string };

type Body = {
  complaintId?: string;
  resolvedBy?: string;
  resolutionNote?: string;
  confirm?: string;
};

function normalizeString(value: unknown) {
  return String(value || "").trim();
}

export async function POST(req: Request) {
  try {
    requireAdminKey(req);
    const body = await readJson<Body>(req);
    const complaintId = normalizeString(body.complaintId);
    const resolvedBy = normalizeString(body.resolvedBy).slice(0, 60);
    const resolutionNote = normalizeString(body.resolutionNote).slice(0, 300);
    const confirm = normalizeString(body.confirm);

    if (!mongoose.Types.ObjectId.isValid(complaintId)) {
      return fail("VALIDATION_ERROR", "Invalid complaintId.", 400);
    }
    if (confirm !== "RESOLVE") {
      return fail("VALIDATION_ERROR", "confirm must be RESOLVE.", 400);
    }

    await dbConnect();
    const updated = await Complaint.findOneAndUpdate(
      { _id: new mongoose.Types.ObjectId(complaintId) },
      {
        $set: {
          status: "resolved",
          resolvedAt: new Date(),
          resolvedBy: resolvedBy || "admin",
          resolutionNote: resolutionNote || null,
        },
      },
      { returnDocument: "after" }
    )
      .select(
        "_id orderNumber businessId businessName type message status createdAt resolvedAt resolvedBy resolutionNote"
      )
      .lean();

    if (!updated) return fail("NOT_FOUND", "Complaint not found.", 404);

    return ok({
      complaint: {
        complaintId: String(updated._id),
        orderNumber: updated.orderNumber,
        businessId: String(updated.businessId),
        businessName: updated.businessName,
        type: updated.type,
        message: updated.message,
        status: updated.status,
        createdAt: updated.createdAt,
        resolvedAt: updated.resolvedAt || null,
        resolvedBy: updated.resolvedBy || null,
        resolutionNote: updated.resolutionNote || null,
      },
    });
  } catch (error: unknown) {
    const err = error as ApiError;
    return fail(err.code || "SERVER_ERROR", err.message || "Could not resolve complaint.", err.status || 500);
  }
}

