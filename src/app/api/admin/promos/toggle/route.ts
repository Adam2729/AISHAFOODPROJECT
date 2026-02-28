import mongoose from "mongoose";
import { dbConnect } from "@/lib/mongodb";
import { ok, fail, readJson } from "@/lib/apiResponse";
import { requireAdminKey } from "@/lib/adminAuth";
import { Promo } from "@/models/Promo";

type ApiError = Error & { status?: number; code?: string };

type Body = {
  promoId?: string;
  isActive?: boolean;
};

export async function POST(req: Request) {
  try {
    requireAdminKey(req);
    const body = await readJson<Body>(req);
    const promoId = String(body.promoId || "").trim();

    if (!mongoose.Types.ObjectId.isValid(promoId)) {
      return fail("VALIDATION_ERROR", "Invalid promoId.", 400);
    }
    if (typeof body.isActive !== "boolean") {
      return fail("VALIDATION_ERROR", "isActive must be boolean.", 400);
    }

    await dbConnect();
    const promo = await Promo.findOneAndUpdate(
      { _id: new mongoose.Types.ObjectId(promoId) },
      { $set: { isActive: body.isActive } },
      { returnDocument: "after" }
    ).lean();
    if (!promo) {
      return fail("NOT_FOUND", "Promo not found.", 404);
    }

    return ok({ promo });
  } catch (error: unknown) {
    const err = error as ApiError;
    return fail(err.code || "SERVER_ERROR", err.message || "Could not toggle promo.", err.status || 500);
  }
}
