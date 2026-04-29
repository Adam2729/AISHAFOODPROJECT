import mongoose from "mongoose";
import { Business } from "@/models/Business";
import { computeSubscriptionStatus } from "@/lib/subscription";

type SubscriptionInput = {
  trialEndsAt?: Date | string | null;
  paidUntilAt?: Date | string | null;
  graceDays?: number | null;
};

export async function requireMerchantBusinessAvailable(
  businessId: string,
  options?: { allowMustChange?: boolean }
) {
  if (!mongoose.Types.ObjectId.isValid(businessId)) {
    const err = new Error("Invalid merchant session.") as Error & { status?: number; code?: string };
    err.status = 401;
    err.code = "UNAUTHORIZED";
    throw err;
  }

  const business = await Business.findById(businessId)
    .select("isActive subscription auth.mustChange")
    .lean();
  if (!business || !business.isActive) {
    const err = new Error("Business not available.") as Error & { status?: number; code?: string };
    err.status = 403;
    err.code = "BUSINESS_NOT_AVAILABLE";
    throw err;
  }

  const sub = computeSubscriptionStatus(
    ((business as { subscription?: SubscriptionInput }).subscription || {}) as SubscriptionInput
  );
  if (sub.status === "suspended") {
    const err = new Error("Business suspended.") as Error & { status?: number; code?: string };
    err.status = 403;
    err.code = "BUSINESS_SUSPENDED";
    throw err;
  }

  const mustChange = Boolean(
    (business as { auth?: { mustChange?: boolean } })?.auth?.mustChange
  );
  if (mustChange && !options?.allowMustChange) {
    const err = new Error("PIN change required.") as Error & {
      status?: number;
      code?: string;
    };
    err.status = 403;
    err.code = "PIN_CHANGE_REQUIRED";
    throw err;
  }
}
