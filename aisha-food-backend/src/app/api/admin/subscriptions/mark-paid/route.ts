/* eslint-disable @typescript-eslint/no-explicit-any */
import mongoose from "mongoose";
import { dbConnect } from "@/lib/mongodb";
import { ok, fail, readJson } from "@/lib/apiResponse";
import { requireAdminKey } from "@/lib/adminAuth";
import { addDays } from "@/lib/subscription";
import { Business } from "@/models/Business";

type ApiError = Error & { status?: number; code?: string };

type Body = {
  businessId?: string;
};

export async function POST(req: Request) {
  try {
    requireAdminKey(req);
    const body = await readJson<Body>(req);
    const businessId = String(body.businessId || "").trim();
    if (!mongoose.Types.ObjectId.isValid(businessId)) {
      return fail("VALIDATION_ERROR", "Invalid businessId.");
    }

    await dbConnect();
    const business: any = await Business.findById(businessId);
    if (!business) return fail("NOT_FOUND", "Business not found.", 404);

    const now = new Date();
    const currentPaidUntil = business.subscription?.paidUntilAt ? new Date(business.subscription.paidUntilAt) : null;
    const start = currentPaidUntil && currentPaidUntil > now ? currentPaidUntil : now;
    const paidUntilAt = addDays(start, 30);

    business.subscription = {
      ...(business.subscription || {}),
      status: "active",
      lastPaidAt: now,
      paidUntilAt,
    };
    await business.save();

    return ok({
      businessId,
      paidUntilAt,
      status: "active",
    });
  } catch (e: unknown) {
    const err = e as ApiError;
    return fail(err.code || "SERVER_ERROR", err.message || "Could not mark subscription paid.", err.status || 500);
  }
}
