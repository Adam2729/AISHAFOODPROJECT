import mongoose from "mongoose";
import { dbConnect } from "@/lib/mongodb";
import {
  ENV_ALLOW_SEED,
  ENV_BAMAKO_BASE_LOCATION,
  ENV_LAUNCH_CITY_CODE,
  ENV_MULTICITY_ENABLE_BAMAKO,
  ENV_NODE_ENV,
} from "@/lib/env";
import { BASE_LOCATION } from "@/lib/constants";
import { isWithinRadiusKm } from "@/lib/geo";
import { City } from "@/models/City";

export type DeliveryFeeBand = {
  minKm: number;
  maxKm: number;
  fee: number;
};

export type CityLean = {
  _id: mongoose.Types.ObjectId;
  code: "SDQ" | "BKO" | string;
  slug: string;
  name: string;
  country: string;
  currency: "DOP" | "CFA";
  maxDeliveryRadiusKm: number;
  coverageCenterLat: number;
  coverageCenterLng: number;
  commissionRate: number;
  subscriptionEnabled: boolean;
  subscriptionPrice: number;
  deliveryFeeModel: "restaurantPays" | "customerPays";
  deliveryFeeBands: DeliveryFeeBand[];
  deliveryFeeCurrency: "DOP" | "CFA";
  riderPayoutModel: "none" | "perDelivery";
  riderPayoutFlat: number;
  platformDeliveryMargin: number;
  paymentMethods: Array<
    | "cash"
    | "orangeMoney"
    | "orange_money"
    | "wave"
    | "moovMoney"
    | "moov_money"
    | "mobile_money"
    | "paytech"
  >;
  riderModel: "selfDelivery" | "freelance" | "hybrid";
  supportWhatsAppE164: string;
  isActive: boolean;
  createdAt?: Date;
  updatedAt?: Date;
};

type SeedCityInput = Omit<CityLean, "_id" | "createdAt" | "updatedAt">;

const BAMAKO_CITY_CODE = "BKO";
const SANTO_DOMINGO_CITY_CODE = "SDQ";
const DEFAULT_CITY_CODE =
  String(ENV_LAUNCH_CITY_CODE || "").trim().toUpperCase() === SANTO_DOMINGO_CITY_CODE
    ? SANTO_DOMINGO_CITY_CODE
    : BAMAKO_CITY_CODE;
const BAMAKO_CITY_KEY = "Bamako|Mali";
const SANTO_DOMINGO_CITY_KEY = "Santo Domingo|Dominican Republic";
const CACHE_TTL_MS = 60_000;
const BAMAKO_FALLBACK_CENTER = {
  lat: 12.6392,
  lng: -8.0029,
} as const;

let defaultCityCache: { value: CityLean | null; expiresAt: number } = {
  value: null,
  expiresAt: 0,
};
let autoSeedPromise: Promise<void> | null = null;
let autoSeedAttempted = false;

function normalizeName(value: unknown) {
  return String(value || "").trim();
}

function cityKey(name: string, country: string) {
  return `${normalizeName(name)}|${normalizeName(country)}`;
}

function normalizeSlug(value: string) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function isMissingValue(value: unknown) {
  if (value === undefined || value === null) return true;
  if (typeof value === "string") return value.trim().length === 0;
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

function isNullIsland(lat: unknown, lng: unknown) {
  const latNum = Number(lat);
  const lngNum = Number(lng);
  if (!Number.isFinite(latNum) || !Number.isFinite(lngNum)) return true;
  return Math.abs(latNum) < 0.000001 && Math.abs(lngNum) < 0.000001;
}

function shouldSeedField(
  existing: Partial<CityLean>,
  seed: SeedCityInput,
  field: keyof SeedCityInput
) {
  if (isMissingValue(existing[field])) return true;

  if (field === "coverageCenterLat" || field === "coverageCenterLng") {
    return isNullIsland(existing.coverageCenterLat, existing.coverageCenterLng);
  }

  const existingNum = Number(existing[field]);
  if (field === "maxDeliveryRadiusKm") {
    return !Number.isFinite(existingNum) || existingNum <= 0;
  }

  if (field === "commissionRate") {
    return !Number.isFinite(existingNum) || existingNum < 0 || existingNum > 1;
  }

  if (field === "deliveryFeeCurrency") {
    const value = String(existing[field] || "").trim().toUpperCase();
    return value !== "DOP" && value !== "CFA";
  }

  if (field === "riderPayoutModel") {
    const value = String(existing[field] || "").trim();
    return value !== "none" && value !== "perDelivery";
  }

  if (field === "deliveryFeeModel") {
    const value = String(existing[field] || "").trim();
    return value !== "restaurantPays" && value !== "customerPays";
  }

  if (field === "supportWhatsAppE164") {
    const normalized = String(existing[field] || "").replace(/\D+/g, "");
    return normalized === "18090000000" || normalized === "22300000000";
  }

  if (field === "paymentMethods") {
    const current = Array.isArray(existing.paymentMethods)
      ? existing.paymentMethods.map((value) => String(value || "").trim())
      : [];
    const next = Array.isArray(seed.paymentMethods)
      ? seed.paymentMethods.map((value) => String(value || "").trim())
      : [];
    if (!current.length) return true;
    const currentSet = new Set(current);
    return next.some((value) => !currentSet.has(value));
  }

  if (field === "isActive") {
    return Boolean(seed.isActive) && existing.isActive !== true;
  }

  return false;
}

function getBamakoSeedCenter() {
  const lat = Number(ENV_BAMAKO_BASE_LOCATION.lat);
  const lng = Number(ENV_BAMAKO_BASE_LOCATION.lng);
  if (Number.isFinite(lat) && Number.isFinite(lng)) {
    return { lat, lng };
  }
  return BAMAKO_FALLBACK_CENTER;
}

function seedConfig(): SeedCityInput[] {
  const bamakoActive =
    ENV_MULTICITY_ENABLE_BAMAKO || DEFAULT_CITY_CODE === BAMAKO_CITY_CODE;
  const bamakoCenter = getBamakoSeedCenter();
  return [
    {
      code: SANTO_DOMINGO_CITY_CODE,
      slug: "santo-domingo",
      name: "Santo Domingo",
      country: "Dominican Republic",
      currency: "DOP",
      maxDeliveryRadiusKm: 8,
      coverageCenterLat: Number(BASE_LOCATION.lat),
      coverageCenterLng: Number(BASE_LOCATION.lng),
      commissionRate: 0.08,
      subscriptionEnabled: true,
      subscriptionPrice: 1000,
      deliveryFeeModel: "restaurantPays",
      deliveryFeeBands: [],
      deliveryFeeCurrency: "DOP",
      riderPayoutModel: "none",
      riderPayoutFlat: 0,
      platformDeliveryMargin: 0,
      paymentMethods: ["cash"],
      riderModel: "selfDelivery",
      supportWhatsAppE164: "",
      isActive: true,
    },
    {
      code: BAMAKO_CITY_CODE,
      slug: "bamako",
      name: "Bamako",
      country: "Mali",
      currency: "CFA",
      maxDeliveryRadiusKm: 8,
      coverageCenterLat: Number(bamakoCenter.lat),
      coverageCenterLng: Number(bamakoCenter.lng),
      commissionRate: 0.12,
      subscriptionEnabled: false,
      subscriptionPrice: 0,
      deliveryFeeModel: "customerPays",
      deliveryFeeBands: [
        { minKm: 0, maxKm: 3, fee: 1000 },
        { minKm: 3, maxKm: 5, fee: 1500 },
        { minKm: 5, maxKm: 8, fee: 2000 },
      ],
      deliveryFeeCurrency: "CFA",
      riderPayoutModel: "perDelivery",
      riderPayoutFlat: 1200,
      platformDeliveryMargin: 200,
      paymentMethods: [
        "cash",
        "orange_money",
        "wave",
        "moov_money",
        "mobile_money",
        "paytech",
      ],
      riderModel: "freelance",
      supportWhatsAppE164: "",
      isActive: bamakoActive,
    },
  ];
}

function getDefaultSeed() {
  return (
    seedConfig().find((row) => String(row.code || "").trim().toUpperCase() === DEFAULT_CITY_CODE) ||
    seedConfig()[0]
  );
}

export async function seedCities() {
  await dbConnect();
  const seeds = seedConfig();
  let createdCount = 0;
  let updatedCount = 0;

  for (const seed of seeds) {
    const existing =
      (await City.findOne({ code: seed.code }).lean<Partial<CityLean> | null>()) ||
      (await City.findOne({ name: seed.name, country: seed.country }).lean<Partial<CityLean> | null>());
    if (!existing) {
      await City.create(seed);
      createdCount += 1;
      continue;
    }

    const updates: Record<string, unknown> = {};
    const fields = Object.keys(seed) as Array<keyof SeedCityInput>;
    for (const field of fields) {
      if (shouldSeedField(existing, seed, field)) {
        updates[field] = seed[field];
      }
    }

    if (Object.keys(updates).length) {
      await City.updateOne({ _id: existing._id }, { $set: updates });
      updatedCount += 1;
    }
  }

  defaultCityCache = { value: null, expiresAt: 0 };
  return {
    total: seeds.length,
    createdCount,
    updatedCount,
  };
}

async function ensureAutoSeeded() {
  if (autoSeedAttempted) {
    if (autoSeedPromise) await autoSeedPromise;
    return;
  }
  autoSeedAttempted = true;
  if (!ENV_ALLOW_SEED || ENV_NODE_ENV === "production") return;
  autoSeedPromise = seedCities()
    .then(() => undefined)
    .catch(() => undefined)
    .finally(() => {
      autoSeedPromise = null;
    });
  await autoSeedPromise;
}

export async function getDefaultCity() {
  await ensureAutoSeeded();
  const now = Date.now();
  if (defaultCityCache.value && defaultCityCache.expiresAt > now) {
    return defaultCityCache.value;
  }

  await dbConnect();
  const defaultSeed = getDefaultSeed();
  let city = await City.findOne({ code: defaultSeed.code }).lean<CityLean | null>();
  if (!city) {
    city = await City.findOne({
      name: defaultSeed.name,
      country: defaultSeed.country,
    }).lean<CityLean | null>();
  }

  if (!city) {
    await seedCities();
    city = await City.findOne({ code: defaultSeed.code }).lean<CityLean | null>();
    if (!city) {
      city = await City.findOne({
        name: defaultSeed.name,
        country: defaultSeed.country,
      }).lean<CityLean | null>();
    }
  }

  if (!city) {
    const created = await City.create(defaultSeed);
    city = created.toObject() as CityLean;
  }

  if (!city.isActive) {
    const activeFallback = await City.findOne({ isActive: true }).sort({ name: 1 }).lean<CityLean | null>();
    if (activeFallback) {
      city = activeFallback;
    }
  }

  defaultCityCache = {
    value: city,
    expiresAt: now + CACHE_TTL_MS,
  };
  return city;
}

async function resolveCityIdFromBody(req: Request) {
  const method = String(req.method || "").toUpperCase();
  if (!["POST", "PATCH", "PUT"].includes(method)) return "";
  if (req.bodyUsed) return "";

  const contentType = String(req.headers.get("content-type") || "").toLowerCase();
  if (!contentType.includes("application/json")) return "";

  const contentLengthHeader = req.headers.get("content-length");
  if (contentLengthHeader != null) {
    const contentLength = Number(contentLengthHeader);
    if (Number.isFinite(contentLength) && contentLength <= 0) return "";
  }

  try {
    const raw = (await req.clone().json()) as { cityId?: unknown; city?: unknown } | null;
    const cityId = normalizeName(raw?.cityId);
    const city = normalizeName(raw?.city);
    return cityId || city;
  } catch {
    return "";
  }
}

type ResolveSelectorSource =
  | "header_x_city"
  | "header_x_city_id"
  | "query_city"
  | "query_city_id"
  | "body";

function sanitizeSelectorForLog(value: string) {
  return String(value || "").trim().slice(0, 80) || null;
}

function logCityFallback(req: Request, payload: {
  reason: "missing_selector" | "selector_not_found";
  selectorSource: ResolveSelectorSource | null;
  selector?: string;
  fallbackCity: Pick<CityLean, "_id" | "code" | "slug" | "name" | "country">;
}) {
  const url = new URL(req.url);
  const requestId = String(req.headers.get("x-request-id") || "").trim() || null;
  console.log(
    JSON.stringify({
      type: "city_resolution_fallback",
      route: url.pathname,
      method: req.method,
      requestId,
      reason: payload.reason,
      selectorSource: payload.selectorSource,
      selector: sanitizeSelectorForLog(payload.selector || ""),
      fallbackCityId: String(payload.fallbackCity._id),
      fallbackCityCode: cityCode(payload.fallbackCity) || null,
      fallbackCitySlug: citySlug(payload.fallbackCity) || null,
      fallbackCityName: String(payload.fallbackCity.name || ""),
      fallbackCityCountry: String(payload.fallbackCity.country || ""),
      timestamp: new Date().toISOString(),
    })
  );
}

async function findCityBySelector(selector: string) {
  const candidate = normalizeName(selector);
  if (!candidate) return null;

  if (mongoose.Types.ObjectId.isValid(candidate)) {
    const byId = await City.findById(new mongoose.Types.ObjectId(candidate)).lean<CityLean | null>();
    if (byId) return byId;
  }

  const normalizedCode = cityCode({ code: candidate });
  const normalizedSlug = citySlug({ slug: candidate });

  return City.findOne({
    $or: [{ code: normalizedCode }, { slug: normalizedSlug }],
  }).lean<CityLean | null>();
}

export async function resolveCityFromRequest(req: Request) {
  await ensureAutoSeeded();
  await dbConnect();
  const url = new URL(req.url);
  const headerCity = normalizeName(req.headers.get("x-city"));
  const headerCityId = normalizeName(req.headers.get("x-city-id"));
  const queryCity = normalizeName(url.searchParams.get("city"));
  const queryCityId = normalizeName(url.searchParams.get("cityId"));
  const bodyCitySelector = await resolveCityIdFromBody(req);

  const candidates: Array<{ selector: string; source: ResolveSelectorSource }> = [];
  if (headerCity) candidates.push({ selector: headerCity, source: "header_x_city" });
  if (headerCityId) candidates.push({ selector: headerCityId, source: "header_x_city_id" });
  if (queryCity) candidates.push({ selector: queryCity, source: "query_city" });
  if (queryCityId) candidates.push({ selector: queryCityId, source: "query_city_id" });
  if (bodyCitySelector) candidates.push({ selector: bodyCitySelector, source: "body" });

  for (const candidate of candidates) {
    const found = await findCityBySelector(candidate.selector);
    if (found) return found;
  }

  const fallbackCity = await getDefaultCity();
  if (candidates.length === 0) {
    logCityFallback(req, {
      reason: "missing_selector",
      selectorSource: null,
      fallbackCity,
    });
  } else {
    logCityFallback(req, {
      reason: "selector_not_found",
      selectorSource: candidates[0].source,
      selector: candidates[0].selector,
      fallbackCity,
    });
  }
  return fallbackCity;
}

export function requireActiveCity(city: Pick<CityLean, "isActive" | "code" | "name" | "country">) {
  if (!city.isActive) {
    const err = new Error("City is not active.") as Error & { status?: number; code?: string };
    err.status = 403;
    err.code = "CITY_INACTIVE";
    throw err;
  }
}

export function normalizeMoneyCurrency(city: Pick<CityLean, "currency">) {
  return city.currency === "CFA" ? "CFA" : "DOP";
}

export function buildCityScopedFilter(
  cityId: mongoose.Types.ObjectId | string,
  options?: { includeUnassigned?: boolean }
) {
  const cityObjectId =
    cityId instanceof mongoose.Types.ObjectId ? cityId : new mongoose.Types.ObjectId(String(cityId));
  if (options?.includeUnassigned) {
    return {
      $or: [{ cityId: cityObjectId }, { cityId: { $exists: false } }, { cityId: null }],
    };
  }
  return { cityId: cityObjectId };
}

export async function listCitiesForPublic() {
  await getDefaultCity();
  await dbConnect();
  return City.find({ isActive: true }).sort({ name: 1 }).lean<CityLean[]>();
}

export function isDefaultCity(
  city: Pick<CityLean, "_id" | "name" | "country" | "code">,
  defaultCityId?: unknown
) {
  if (defaultCityId && String(city._id) === String(defaultCityId)) return true;
  if (String(city.code || "").trim().toUpperCase() === DEFAULT_CITY_CODE) return true;
  const key = cityKey(city.name, city.country);
  return key === (DEFAULT_CITY_CODE === BAMAKO_CITY_CODE ? BAMAKO_CITY_KEY : SANTO_DOMINGO_CITY_KEY);
}

export function isBamakoCity(city: Pick<CityLean, "name" | "country" | "code">) {
  if (String(city.code || "").trim().toUpperCase() === BAMAKO_CITY_CODE) return true;
  return cityKey(city.name, city.country) === BAMAKO_CITY_KEY;
}

export function getCityCenter(city: Partial<Pick<CityLean, "coverageCenterLat" | "coverageCenterLng">>) {
  const lat = Number(city.coverageCenterLat);
  const lng = Number(city.coverageCenterLng);
  if (Number.isFinite(lat) && Number.isFinite(lng)) {
    return { lat, lng };
  }
  const defaultSeed = getDefaultSeed();
  return {
    lat: Number(defaultSeed.coverageCenterLat || BASE_LOCATION.lat),
    lng: Number(defaultSeed.coverageCenterLng || BASE_LOCATION.lng),
  };
}

export function isWithinCityCoverage(
  city: Pick<CityLean, "maxDeliveryRadiusKm" | "coverageCenterLat" | "coverageCenterLng">,
  lat: number,
  lng: number
) {
  const center = getCityCenter(city);
  const radius = Number(city.maxDeliveryRadiusKm || 0) > 0 ? Number(city.maxDeliveryRadiusKm) : 8;
  return isWithinRadiusKm(center.lat, center.lng, lat, lng, radius);
}

export function isBusinessWithinCityCoverage(
  city: Pick<CityLean, "maxDeliveryRadiusKm" | "coverageCenterLat" | "coverageCenterLng">,
  businessLat: number,
  businessLng: number
) {
  return isWithinCityCoverage(city, businessLat, businessLng);
}

export async function getCityByIdOrDefault(cityId: unknown) {
  if (cityId && mongoose.Types.ObjectId.isValid(String(cityId))) {
    await dbConnect();
    const found = await City.findById(new mongoose.Types.ObjectId(String(cityId))).lean<CityLean | null>();
    if (found) return found;
  }
  return getDefaultCity();
}

export function cityCode(city: Partial<Pick<CityLean, "code">>) {
  return String(city.code || "").trim().toUpperCase();
}

export function citySlug(city: Partial<Pick<CityLean, "slug" | "name">>) {
  const raw = String(city.slug || "").trim();
  if (raw) return normalizeSlug(raw);
  return normalizeSlug(String(city.name || ""));
}
