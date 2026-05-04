import { dbConnect } from "@/lib/mongodb";
import { ok, fail, readJson } from "@/lib/apiResponse";
import { assertNotInMaintenance } from "@/lib/maintenance";
import { requireUserSession } from "@/lib/userAuth";
import { getDefaultCity } from "@/lib/city";
import { User } from "@/models/User";

type ApiError = Error & { status?: number; code?: string };

type PatchBody = {
  displayName?: string;
  city?: string;
  preferredLanguage?: "es" | "en";
  marketingOptIn?: boolean;
  favoriteCuisines?: string[];
};

type UserLean = {
  _id: unknown;
  phoneHash: string;
  cityId?: unknown;
  displayName?: string;
  city?: string;
  preferredLanguage?: "es" | "en";
  marketingOptIn?: boolean;
  favoriteCuisines?: string[];
  createdAt?: Date;
  updatedAt?: Date;
  lastSeenAt?: Date | null;
};

function normalizeText(value: unknown, maxLen: number) {
  const text = String(value || "").trim();
  if (!text) return "";
  return text.slice(0, maxLen);
}

function normalizeFavoriteCuisines(input: unknown) {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  const values: string[] = [];
  for (const raw of input) {
    const normalized = normalizeText(raw, 24).toLowerCase();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    values.push(normalized);
    if (values.length >= 10) break;
  }
  return values;
}

function toProfilePayload(user: UserLean) {
  return {
    id: String(user._id || ""),
    cityId: user.cityId ? String(user.cityId) : null,
    displayName: String(user.displayName || ""),
    city: String(user.city || ""),
    preferredLanguage: user.preferredLanguage === "en" ? "en" : "es",
    marketingOptIn: Boolean(user.marketingOptIn),
    favoriteCuisines: Array.isArray(user.favoriteCuisines) ? user.favoriteCuisines : [],
    createdAt: user.createdAt || null,
    updatedAt: user.updatedAt || null,
    lastSeenAt: user.lastSeenAt || null,
  };
}

async function loadOrCreateUser(phoneHash: string) {
  await User.updateOne(
    { phoneHash },
    {
      $setOnInsert: {
        phoneHash,
        displayName: "",
        city: "",
        preferredLanguage: "es",
        marketingOptIn: false,
        favoriteCuisines: [],
      },
      $set: { lastSeenAt: new Date() },
    },
    { upsert: true }
  );
  return User.findOne({ phoneHash }).lean<UserLean | null>();
}

export async function GET(req: Request) {
  try {
    await assertNotInMaintenance();
    const session = requireUserSession(req);
    await dbConnect();
    const defaultCity = await getDefaultCity();

    const user = await loadOrCreateUser(session.phoneHash);
    if (!user) return fail("NOT_FOUND", "Profile not found.", 404);
    if (!user.cityId) {
      await User.updateOne(
        {
          _id: user._id,
          $or: [{ cityId: null }, { cityId: { $exists: false } }],
        },
        { $set: { cityId: defaultCity._id } }
      );
      const refreshed = await User.findById(user._id).lean<UserLean | null>();
      if (refreshed) return ok({ profile: toProfilePayload(refreshed) });
    }

    return ok({ profile: toProfilePayload(user) });
  } catch (error: unknown) {
    const err = error as ApiError;
    return fail(
      err.code || "SERVER_ERROR",
      err.message || "Could not load profile.",
      err.status || 500
    );
  }
}

export async function PATCH(req: Request) {
  try {
    await assertNotInMaintenance();
    const session = requireUserSession(req);
    const body = await readJson<PatchBody>(req);
    await dbConnect();
    const defaultCity = await getDefaultCity();

    const updates: Record<string, unknown> = {};
    if (body.displayName !== undefined) {
      updates.displayName = normalizeText(body.displayName, 80);
    }
    if (body.city !== undefined) {
      updates.city = normalizeText(body.city, 80);
    }
    if (body.preferredLanguage !== undefined) {
      const lang = String(body.preferredLanguage || "").trim().toLowerCase();
      if (lang !== "es" && lang !== "en") {
        return fail("VALIDATION_ERROR", "preferredLanguage must be es or en.", 400);
      }
      updates.preferredLanguage = lang;
    }
    if (body.marketingOptIn !== undefined) {
      if (typeof body.marketingOptIn !== "boolean") {
        return fail("VALIDATION_ERROR", "marketingOptIn must be boolean.", 400);
      }
      updates.marketingOptIn = body.marketingOptIn;
    }
    if (body.favoriteCuisines !== undefined) {
      updates.favoriteCuisines = normalizeFavoriteCuisines(body.favoriteCuisines);
    }

    if (!Object.keys(updates).length) {
      return fail("VALIDATION_ERROR", "No valid fields provided.", 400);
    }

    const now = new Date();
    const updated = await User.findOneAndUpdate(
      { phoneHash: session.phoneHash },
      {
        $setOnInsert: {
          phoneHash: session.phoneHash,
          cityId: defaultCity._id,
        },
        $set: {
          ...updates,
          lastSeenAt: now,
        },
      },
      {
        upsert: true,
        returnDocument: "after",
      }
    ).lean<UserLean | null>();

    if (!updated) return fail("NOT_FOUND", "Profile not found.", 404);
    return ok({ profile: toProfilePayload(updated) });
  } catch (error: unknown) {
    const err = error as ApiError;
    return fail(
      err.code || "SERVER_ERROR",
      err.message || "Could not update profile.",
      err.status || 500
    );
  }
}
