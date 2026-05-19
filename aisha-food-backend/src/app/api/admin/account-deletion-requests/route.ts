import mongoose from "mongoose";
import { fail, ok, readJson } from "@/lib/apiResponse";
import { requireAdminKey } from "@/lib/adminAuth";
import { dbConnect } from "@/lib/mongodb";
import { AccountDeletionRequest } from "@/models/AccountDeletionRequest";

type ApiError = Error & { status?: number; code?: string };

type PatchBody = {
  id?: string;
  status?: string;
};

const REQUEST_STATUSES = new Set(["pending", "processing", "completed"]);

export async function GET(req: Request) {
  try {
    requireAdminKey(req);
    await dbConnect();

    const url = new URL(req.url);
    const status = String(url.searchParams.get("status") || "")
      .trim()
      .toLowerCase();
    const limit = Math.max(1, Math.min(200, Number(url.searchParams.get("limit") || 100)));

    const filter: Record<string, unknown> = {};
    if (status) {
      if (!REQUEST_STATUSES.has(status)) {
        return fail("VALIDATION_ERROR", "Invalid status filter.", 400);
      }
      filter.status = status;
    }

    const rows = await AccountDeletionRequest.find(filter)
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();

    return ok({
      rows: rows.map((row) => ({
        id: String(row._id),
        name: String(row.name || ""),
        email_or_phone: String(row.email_or_phone || ""),
        accountType: String(row.accountType || "customer"),
        reason: String(row.reason || ""),
        status: String(row.status || "pending"),
        createdAt: row.createdAt || null,
      })),
    });
  } catch (error: unknown) {
    const err = error as ApiError;
    return fail(
      err.code || "SERVER_ERROR",
      err.message || "Could not load account deletion requests.",
      err.status || 500
    );
  }
}

export async function PATCH(req: Request) {
  try {
    requireAdminKey(req);
    await dbConnect();

    const body = await readJson<PatchBody>(req);
    const id = String(body?.id || "").trim();
    const status = String(body?.status || "").trim().toLowerCase();

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return fail("VALIDATION_ERROR", "Invalid request id.", 400);
    }
    if (!REQUEST_STATUSES.has(status)) {
      return fail("VALIDATION_ERROR", "Invalid status.", 400);
    }

    const updated = await AccountDeletionRequest.findByIdAndUpdate(
      id,
      { $set: { status } },
      { returnDocument: "after" }
    ).lean();

    if (!updated) {
      return fail("NOT_FOUND", "Account deletion request not found.", 404);
    }

    return ok({
      request: {
        id: String(updated._id),
        name: String(updated.name || ""),
        email_or_phone: String(updated.email_or_phone || ""),
        accountType: String(updated.accountType || "customer"),
        reason: String(updated.reason || ""),
        status: String(updated.status || "pending"),
        createdAt: updated.createdAt || null,
      },
    });
  } catch (error: unknown) {
    const err = error as ApiError;
    return fail(
      err.code || "SERVER_ERROR",
      err.message || "Could not update account deletion request.",
      err.status || 500
    );
  }
}
