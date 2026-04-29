import { dbConnect } from "@/lib/mongodb";
import { ok, fail } from "@/lib/apiResponse";
import { assertNotInMaintenance } from "@/lib/maintenance";
import { consumeRateLimit } from "@/lib/requestRateLimit";
import { normalizePhone, phoneToHash } from "@/lib/phoneHash";
import { Favorite } from "@/models/Favorite";

type ApiError = Error & { status?: number; code?: string };

export async function GET(req: Request) {
  try {
    await assertNotInMaintenance();

    const url = new URL(req.url);
    const phoneRaw = String(url.searchParams.get("phone") || "").trim();
    if (!phoneRaw) {
      return fail("VALIDATION_ERROR", "phone is required.", 400);
    }
    const normalizedPhone = normalizePhone(phoneRaw);
    if (!normalizedPhone) {
      return fail("VALIDATION_ERROR", "Invalid phone.", 400);
    }
    const phoneHash = phoneToHash(normalizedPhone);
    const limitState = consumeRateLimit(`public-favorites-get:${phoneHash}`, 30, 10 * 60 * 1000);
    if (!limitState.allowed) {
      return fail("RATE_LIMIT", "Too many requests. Try later.", 429);
    }

    await dbConnect();
    const favorites = await Favorite.find({ phoneHash })
      .sort({ createdAt: -1 })
      .select("businessId createdAt")
      .lean();

    return ok({
      favorites: favorites.map((favorite) => ({
        businessId: String(favorite.businessId),
        createdAt: favorite.createdAt,
      })),
    });
  } catch (error: unknown) {
    const err = error as ApiError;
    return fail(err.code || "SERVER_ERROR", err.message || "Could not load favorites.", err.status || 500);
  }
}

