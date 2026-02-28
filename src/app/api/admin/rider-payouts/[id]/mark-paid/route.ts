import mongoose from "mongoose";
import { dbConnect } from "@/lib/mongodb";
import { ok, fail, readJson } from "@/lib/apiResponse";
import { requireAdminKey } from "@/lib/adminAuth";
import { RiderPayout } from "@/models/RiderPayout";

type ApiError = Error & { status?: number; code?: string };

type Body = {
  note?: string;
  paidByAdminId?: string;
};

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    requireAdminKey(req);
    const { id } = await params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return fail("VALIDATION_ERROR", "Invalid payout id.", 400);
    }

    const body = await readJson<Body>(req);
    const note = String(body.note || "").trim().slice(0, 280);
    const paidByAdminId = String(body.paidByAdminId || "").trim().slice(0, 80);

    await dbConnect();
    const now = new Date();
    const updated = await RiderPayout.findOneAndUpdate(
      {
        _id: new mongoose.Types.ObjectId(id),
        status: "pending",
      },
      {
        $set: {
          status: "paid",
          paidAt: now,
          paidByAdminId: paidByAdminId || null,
          note: note || null,
        },
      },
      { returnDocument: "after" }
    ).lean<{
      _id: mongoose.Types.ObjectId;
      status: "pending" | "paid" | "void";
      paidAt?: Date | null;
      paidByAdminId?: string | null;
      note?: string | null;
    } | null>();
    if (!updated) {
      const existing = await RiderPayout.findById(new mongoose.Types.ObjectId(id)).lean<{
        _id: mongoose.Types.ObjectId;
        status: "pending" | "paid" | "void";
        paidAt?: Date | null;
        paidByAdminId?: string | null;
        note?: string | null;
      } | null>();
      if (!existing) return fail("NOT_FOUND", "Payout not found.", 404);
      if (existing.status === "paid") {
        return ok({
          payout: {
            id: String(existing._id),
            status: existing.status,
            paidAt: existing.paidAt || null,
            paidByAdminId: String(existing.paidByAdminId || "").trim() || null,
            note: String(existing.note || "").trim() || null,
          },
        });
      }
      return fail("INVALID_STATE", "Only pending payouts can be marked paid.", 409);
    }

    return ok({
      payout: {
        id: String(updated._id),
        status: updated.status,
        paidAt: updated.paidAt || null,
        paidByAdminId: String(updated.paidByAdminId || "").trim() || null,
        note: String(updated.note || "").trim() || null,
      },
    });
  } catch (error: unknown) {
    const err = error as ApiError;
    return fail(
      err.code || "SERVER_ERROR",
      err.message || "Could not mark rider payout as paid.",
      err.status || 500
    );
  }
}

