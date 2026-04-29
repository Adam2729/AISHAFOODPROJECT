import mongoose from "mongoose";
import { dbConnect } from "@/lib/mongodb";
import { ok, fail } from "@/lib/apiResponse";
import { requireAdminKey } from "@/lib/adminAuth";
import { Complaint } from "@/models/Complaint";

type ApiError = Error & { status?: number; code?: string };

type QueryStatus = "open" | "resolved";

function parseLimit(raw: string | null) {
  const parsed = Number(raw || 50);
  if (!Number.isFinite(parsed)) return 50;
  return Math.max(1, Math.min(200, Math.floor(parsed)));
}

export async function GET(req: Request) {
  try {
    requireAdminKey(req);
    const url = new URL(req.url);
    const status = String(url.searchParams.get("status") || "").trim().toLowerCase();
    const businessId = String(url.searchParams.get("businessId") || "").trim();
    const limit = parseLimit(url.searchParams.get("limit"));

    const filter: Record<string, unknown> = {};
    if (status) {
      if (status !== "open" && status !== "resolved") {
        return fail("VALIDATION_ERROR", "Invalid status filter.", 400);
      }
      filter.status = status as QueryStatus;
    }
    if (businessId) {
      if (!mongoose.Types.ObjectId.isValid(businessId)) {
        return fail("VALIDATION_ERROR", "Invalid businessId.", 400);
      }
      filter.businessId = new mongoose.Types.ObjectId(businessId);
    }

    await dbConnect();
    const complaints = await Complaint.find(filter)
      .sort({ status: 1, createdAt: -1 })
      .limit(limit)
      .select(
        "_id orderNumber businessId businessName type message status createdAt resolvedAt resolvedBy resolutionNote"
      )
      .lean();

    return ok({
      complaints: complaints.map((complaint) => ({
        complaintId: String(complaint._id),
        orderNumber: complaint.orderNumber,
        businessId: String(complaint.businessId),
        businessName: complaint.businessName,
        type: complaint.type,
        message: complaint.message,
        status: complaint.status,
        createdAt: complaint.createdAt,
        resolvedAt: complaint.resolvedAt || null,
        resolvedBy: complaint.resolvedBy || null,
        resolutionNote: complaint.resolutionNote || null,
      })),
    });
  } catch (error: unknown) {
    const err = error as ApiError;
    return fail(err.code || "SERVER_ERROR", err.message || "Could not load complaints.", err.status || 500);
  }
}

