import { dbConnect } from "@/lib/mongodb";
import { ok, fail, readJson } from "@/lib/apiResponse";
import { assertNotInMaintenance } from "@/lib/maintenance";
import { consumeRateLimit } from "@/lib/requestRateLimit";
import { normalizePhone, phoneToHash } from "@/lib/phoneHash";
import { createUserToken } from "@/lib/userAuth";
import { User } from "@/models/User";

type ApiError = Error & { status?: number; code?: string };

type Body = {
  phone?: string;
};

export async function POST(req: Request) {
  try {
    await assertNotInMaintenance();
    const body = await readJson<Body>(req);
    const phoneRaw = String(body.phone || "").trim();
    const phone = normalizePhone(phoneRaw);
    if (!phone) return fail("VALIDATION_ERROR", "Invalid phone.", 400);

    const phoneHash = phoneToHash(phone);
    const limitState = consumeRateLimit(`public-user-session:${phoneHash}`, 20, 10 * 60 * 1000);
    if (!limitState.allowed) {
      return fail("RATE_LIMIT", "Too many requests. Try later.", 429);
    }

    await dbConnect();
    const existing = await User.findOne({ phoneHash }).select("_id").lean();
    if (!existing) {
      await User.updateOne(
        { phoneHash },
        { $setOnInsert: { phoneHash, preferredLanguage: "es", marketingOptIn: false, favoriteCuisines: [] } },
        { upsert: true }
      );
    }

    const sessionToken = createUserToken(phoneHash, 30);
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

    return ok({
      sessionToken,
      expiresAt,
      profileExists: Boolean(existing),
    });
  } catch (error: unknown) {
    const err = error as ApiError;
    return fail(
      err.code || "SERVER_ERROR",
      err.message || "Could not create user session.",
      err.status || 500
    );
  }
}
