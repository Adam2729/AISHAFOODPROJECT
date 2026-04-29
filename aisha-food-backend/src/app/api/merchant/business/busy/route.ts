import mongoose from "mongoose";
import { dbConnect } from "@/lib/mongodb";
import { ok, fail, readJson } from "@/lib/apiResponse";
import { requireMerchantSession } from "@/lib/merchantAuth";
import { requireMerchantBusinessAvailable } from "@/lib/merchantBusiness";
import { Business } from "@/models/Business";

type ApiError = Error & { status?: number; code?: string };
type Body = {
  minutes?: number;
};

const ALLOWED_MINUTES = new Set([0, 30, 45, 60]);

export async function POST(req: Request) {
  try {
    const session = requireMerchantSession(req);
    const body = await readJson<Body>(req);
    const minutes = Number(body.minutes);
    if (!Number.isFinite(minutes) || !ALLOWED_MINUTES.has(minutes)) {
      return fail("VALIDATION_ERROR", "minutes must be one of: 0, 30, 45, 60.", 400);
    }

    await dbConnect();
    await requireMerchantBusinessAvailable(session.businessId);
    const busyUntil = minutes === 0 ? null : new Date(Date.now() + minutes * 60 * 1000);
    await Business.updateOne(
      { _id: new mongoose.Types.ObjectId(session.businessId) },
      { $set: { busyUntil } }
    );

    return ok({ busyUntil });
  } catch (error: unknown) {
    const err = error as ApiError;
    return fail(
      err.code || "SERVER_ERROR",
      err.message || "Could not update busy mode.",
      err.status || 500
    );
  }
}
