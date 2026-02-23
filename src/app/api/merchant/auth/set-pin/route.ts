/* eslint-disable @typescript-eslint/no-explicit-any */
import mongoose from "mongoose";
import { dbConnect } from "@/lib/mongodb";
import { ok, fail, readJson } from "@/lib/apiResponse";
import { requireMerchantSession } from "@/lib/merchantAuth";
import { requireMerchantBusinessAvailable } from "@/lib/merchantBusiness";
import { hashSecret, verifySecret } from "@/lib/password";
import { Business } from "@/models/Business";

type ApiError = Error & { status?: number; code?: string };

type Body = {
  currentPin?: string;
  newPin?: string;
  confirmPin?: string;
};

function isPinFormatValid(pin: string) {
  return /^\d{4,8}$/.test(pin);
}

export async function POST(req: Request) {
  try {
    const session = requireMerchantSession(req);
    if (!mongoose.Types.ObjectId.isValid(session.businessId)) {
      return fail("UNAUTHORIZED", "Invalid merchant session.", 401);
    }

    const body = await readJson<Body>(req);
    const currentPin = String(body.currentPin || "").trim();
    const newPin = String(body.newPin || "").trim();
    const confirmPin = String(body.confirmPin || "").trim();

    if (!newPin || !confirmPin) {
      return fail("VALIDATION_ERROR", "newPin and confirmPin are required.", 400);
    }
    if (newPin !== confirmPin) {
      return fail("VALIDATION_ERROR", "PIN confirmation does not match.", 400);
    }
    if (!isPinFormatValid(newPin)) {
      return fail("VALIDATION_ERROR", "PIN must be 4 to 8 digits.", 400);
    }

    await dbConnect();
    await requireMerchantBusinessAvailable(session.businessId, { allowMustChange: true });
    const business = await Business.findById(session.businessId);
    if (!business) return fail("NOT_FOUND", "Business not found.", 404);

    const mustChange = Boolean((business as any).auth?.mustChange);
    if (!mustChange) {
      if (!currentPin) return fail("VALIDATION_ERROR", "currentPin is required.", 400);
      const isValidCurrent = verifySecret(currentPin, String((business as any).auth?.pinHash || ""));
      if (!isValidCurrent) return fail("UNAUTHORIZED", "Current PIN is invalid.", 401);
    }

    (business as any).auth = {
      ...((business as any).auth || {}),
      pinHash: hashSecret(newPin),
      mustChange: false,
    };
    await business.save();

    return ok({ updated: true });
  } catch (e: unknown) {
    const err = e as ApiError;
    return fail(err.code || "SERVER_ERROR", err.message || "Could not update PIN.", err.status || 500);
  }
}
