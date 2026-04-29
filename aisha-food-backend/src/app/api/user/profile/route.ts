import { dbConnect } from "@/lib/mongodb";
import { ok, fail, readJson } from "@/lib/apiResponse";
import { assertNotInMaintenance } from "@/lib/maintenance";
import { getDefaultCity, getCityByIdOrDefault, resolveCityFromRequest } from "@/lib/city";
import {
  getMarketConfig,
  isLanguageAllowedForMarket,
  normalizeLanguageForMarket,
} from "@/lib/marketConfig";
import { requireUserSession } from "@/lib/userAuth";
import { User } from "@/models/User";

type ApiError = Error & { status?: number; code?: string };

type PatchBody = {
  name?: string;
  phone?: string;
  displayName?: string;
  city?: string;
  preferredLanguage?: "fr" | "bm" | "en" | "es";
  marketingOptIn?: boolean;
  favoriteCuisines?: string[];
};

type UserLean = {
  _id: unknown;
  phoneHash: string;
  cityId?: unknown;
  displayName?: string;
  city?: string;
  preferredLanguage?: "fr" | "bm" | "en" | "es";
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

function toProfilePayload(
  user: UserLean,
  input: {
    activeCity: Awaited<ReturnType<typeof getDefaultCity>>;
    homeCity: Awaited<ReturnType<typeof getDefaultCity>>;
  }
) {
  const market = getMarketConfig(input.activeCity);
  return {
    id: String(user._id || ""),
    cityId: user.cityId ? String(user.cityId) : null,
    displayName: String(user.displayName || ""),
    city: String(user.city || ""),
    preferredLanguage: normalizeLanguageForMarket(input.activeCity, user.preferredLanguage || market.defaultLanguage),
    marketingOptIn: Boolean(user.marketingOptIn),
    favoriteCuisines: Array.isArray(user.favoriteCuisines) ? user.favoriteCuisines : [],
    createdAt: user.createdAt || null,
    updatedAt: user.updatedAt || null,
    lastSeenAt: user.lastSeenAt || null,
    activeCity: {
      cityId: String(input.activeCity._id),
      code: String(input.activeCity.code || ""),
      name: String(input.activeCity.name || ""),
      country: String(input.activeCity.country || ""),
    },
    homeCity: {
      cityId: String(input.homeCity._id),
      code: String(input.homeCity.code || ""),
      name: String(input.homeCity.name || ""),
      country: String(input.homeCity.country || ""),
    },
    market,
  };
}

async function loadOrCreateUser(phoneHash: string, selectedCity: Awaited<ReturnType<typeof getDefaultCity>>) {
  const market = getMarketConfig(selectedCity);
  await User.updateOne(
    { phoneHash },
    {
      $setOnInsert: {
        phoneHash,
        cityId: selectedCity._id,
        city: String(selectedCity.name || ""),
        displayName: "",
        preferredLanguage: market.defaultLanguage,
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
    const requestCity = await resolveCityFromRequest(req);

    const user = await loadOrCreateUser(session.phoneHash, requestCity);
    if (!user) return fail("NOT_FOUND", "Profile not found.", 404);

    if (!user.cityId) {
      await User.updateOne(
        {
          _id: user._id,
          $or: [{ cityId: null }, { cityId: { $exists: false } }],
        },
        {
          $set: {
            cityId: requestCity._id,
            city: String(user.city || requestCity.name || ""),
          },
        }
      );
    }

    const homeCity = await getCityByIdOrDefault(user.cityId || requestCity._id);
    const refreshed = user.cityId ? user : await User.findById(user._id).lean<UserLean | null>();
    if (!refreshed) return fail("NOT_FOUND", "Profile not found.", 404);

    return ok({
      profile: toProfilePayload(refreshed, {
        activeCity: requestCity,
        homeCity,
      }),
    });
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
    let body: PatchBody;
    try {
      body = await readJson<PatchBody>(req);
    } catch {
      return fail("INVALID_JSON", "Request body must be valid JSON.", 400);
    }
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return fail("VALIDATION_ERROR", "Request body is required.", 400);
    }

    console.log("profile PATCH request", body);

    await dbConnect();
    const requestCity = await resolveCityFromRequest(req);
    const currentUser = await loadOrCreateUser(session.phoneHash, requestCity);
    if (!currentUser?._id) {
      return fail("NOT_FOUND", "User not found.", 404);
    }

    const updates: Record<string, unknown> = {};
    const displayNameInput =
      body.displayName !== undefined ? body.displayName : body.name !== undefined ? body.name : undefined;
    if (displayNameInput !== undefined) {
      updates.displayName = normalizeText(displayNameInput, 80);
    }
    if (body.city !== undefined) {
      updates.city = normalizeText(body.city, 80);
    }
    if (body.preferredLanguage !== undefined) {
      const lang = String(body.preferredLanguage || "").trim().toLowerCase();
      if (!["fr", "bm", "en", "es"].includes(lang)) {
        return fail("VALIDATION_ERROR", "preferredLanguage must be es, en, fr, or bm.", 400);
      }
      if (!isLanguageAllowedForMarket(requestCity, lang)) {
        const market = getMarketConfig(requestCity);
        return fail(
          "VALIDATION_ERROR",
          `preferredLanguage must be one of: ${market.allowedLanguages.join(", ")}.`,
          400
        );
      }
      updates.preferredLanguage = normalizeLanguageForMarket(requestCity, lang);
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
    const updated = await User.findByIdAndUpdate(
      currentUser._id,
      {
        $set: {
          ...(currentUser.cityId ? {} : { cityId: requestCity._id }),
          ...updates,
          lastSeenAt: now,
        },
      },
      { new: true }
    ).lean<UserLean | null>();

    if (!updated) return fail("NOT_FOUND", "User not found.", 404);
    const homeCity = await getCityByIdOrDefault(updated.cityId || requestCity._id);
    const profile = toProfilePayload(updated, {
      activeCity: requestCity,
      homeCity,
    });

    return ok({
      user: profile,
      profile,
    });
  } catch (error: unknown) {
    const err = error as ApiError;
    return fail(
      err.code || "SERVER_ERROR",
      err.message || "Could not update profile.",
      err.status || 500
    );
  }
}
