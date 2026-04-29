import { dbConnect } from "@/lib/mongodb";
import { ok, fail, readJson } from "@/lib/apiResponse";
import { assertNotInMaintenance } from "@/lib/maintenance";
import { normalizePhone, phoneToHash } from "@/lib/phoneHash";
import { requireUserSession } from "@/lib/userAuth";
import { hashSessionId } from "@/lib/pii";
import { createOrderHistoryAccessToken } from "@/lib/orderHistoryAccess";
import { Order } from "@/models/Order";

type Body = {
  phone?: string;
};

export async function POST(req: Request) {
  try {
    await assertNotInMaintenance();
    const session = requireUserSession(req);
    const body = await readJson<Body>(req).catch(() => ({} as Body));
    const phone = normalizePhone(String(body.phone || "").trim());
    const sessionId = String(req.headers.get("x-session-id") || "").trim();

    if (!phone) {
      return fail("VALIDATION_ERROR", "Invalid phone.", 400);
    }
    if (!sessionId) {
      return fail(
        "VERIFICATION_REQUIRED",
        "Verified checkout session required. Reopen the app on the device used at checkout and try again.",
        401
      );
    }

    const phoneHash = phoneToHash(phone);
    if (!phoneHash || phoneHash !== session.phoneHash) {
      return fail(
        "UNAUTHORIZED",
        "Phone does not match the active customer session.",
        403
      );
    }

    const sessionIdHash = hashSessionId(sessionId);
    if (!sessionIdHash) {
      return fail("VERIFICATION_REQUIRED", "Verified checkout session required.", 401);
    }

    await dbConnect();
    const verifiedOrder = await Order.findOne({
      phoneHash,
      sessionIdHash,
    })
      .select("_id")
      .lean();

    if (!verifiedOrder) {
      return fail(
        "VERIFICATION_REQUIRED",
        "Order history is only available from a verified checkout device. Place or reopen a recent order from this device, then try again.",
        403
      );
    }

    const accessToken = createOrderHistoryAccessToken(phoneHash, sessionIdHash, 10);
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

    return ok({
      verified: true,
      accessToken,
      expiresAt,
    });
  } catch (error: unknown) {
    const err = error as Error & { status?: number; code?: string };
    return fail(
      err.code || "SERVER_ERROR",
      err.message || "Could not verify order history access.",
      err.status || 500
    );
  }
}
