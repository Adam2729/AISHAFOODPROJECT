/* eslint-disable @typescript-eslint/no-explicit-any */
import { cookies } from "next/headers";
import { dbConnect } from "@/lib/mongodb";
import { ok, fail, readJson } from "@/lib/apiResponse";
import { merchantCookieName, createMerchantToken } from "@/lib/merchantAuth";
import { verifySecret } from "@/lib/password";
import { Business } from "@/models/Business";
import { computeSubscriptionStatus } from "@/lib/subscription";
import { runSubscriptionStatusJob } from "@/lib/subscriptionJob";

type LoginBody = {
  businessId?: string;
  pin?: string;
  password?: string;
};

export async function POST(req: Request) {
  try {
    const body = await readJson<LoginBody>(req);
    const businessId = String(body.businessId || "").trim();
    const provided = String(body.pin || body.password || "").trim();
    if (!businessId || !provided) {
      return fail("VALIDATION_ERROR", "businessId and pin/password are required.");
    }

    await dbConnect();
    await runSubscriptionStatusJob();
    const business = await Business.findById(businessId);
    if (!business) return fail("UNAUTHORIZED", "Invalid credentials.", 401);

    const isValid = verifySecret(provided, String((business as any).auth?.pinHash || ""));
    if (!isValid) return fail("UNAUTHORIZED", "Invalid credentials.", 401);

    const subscription = computeSubscriptionStatus((business as any).subscription || {});
    if (subscription.status === "suspended") {
      return fail("BUSINESS_SUSPENDED", "Your account is suspended. Contact admin.", 403);
    }

    const token = createMerchantToken(String((business as any)._id));
    const cookieStore = await cookies();
    cookieStore.set(merchantCookieName(), token, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 7 * 24 * 60 * 60,
    });

    return ok({
      business: {
        id: String((business as any)._id),
        name: (business as any).name,
        type: (business as any).type,
      },
    });
  } catch {
    return fail("SERVER_ERROR", "Could not login.", 500);
  }
}
