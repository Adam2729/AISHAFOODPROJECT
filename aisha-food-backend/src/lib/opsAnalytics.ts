import mongoose from "mongoose";
import { isValidWeekKey, normalizeWeekKey } from "@/lib/riderPayouts";
import { cityCode, citySlug, requireActiveCity } from "@/lib/city";
import { City } from "@/models/City";

export type OpsAnalyticsRange = {
  mode: "week" | "range";
  weekKey: string;
  from: Date;
  to: Date;
  fromIso: string;
  toIso: string;
};

export type WeekBounds = {
  start: Date;
  end: Date;
};

type ApiError = Error & { status?: number; code?: string };

const DATE_ONLY_REGEX = /^\d{4}-\d{2}-\d{2}$/;

function makeValidationError(message: string): ApiError {
  const err = new Error(message) as ApiError;
  err.status = 400;
  err.code = "VALIDATION_ERROR";
  return err;
}

export function parseWeekKeyOrThrow(value: unknown, fallbackDate = new Date()) {
  const weekKey = normalizeWeekKey(value, fallbackDate);
  if (!isValidWeekKey(weekKey)) {
    throw makeValidationError("Invalid weekKey format. Use YYYY-Www.");
  }
  return weekKey;
}

export function weekKeyToDateRange(weekKey: string) {
  const normalized = String(weekKey || "").trim();
  const match = normalized.match(/^(\d{4})-W(\d{2})$/);
  if (!match) {
    throw makeValidationError("Invalid weekKey format. Use YYYY-Www.");
  }

  const year = Number(match[1]);
  const week = Number(match[2]);
  if (!Number.isFinite(year) || !Number.isFinite(week) || week < 1 || week > 53) {
    throw makeValidationError("Invalid weekKey format. Use YYYY-Www.");
  }

  const jan4 = new Date(Date.UTC(year, 0, 4));
  const jan4Day = jan4.getUTCDay() || 7;
  const week1Monday = new Date(jan4);
  week1Monday.setUTCDate(jan4.getUTCDate() - (jan4Day - 1));

  const from = new Date(week1Monday);
  from.setUTCDate(week1Monday.getUTCDate() + (week - 1) * 7);

  const to = new Date(from);
  to.setUTCDate(from.getUTCDate() + 7);

  return { from, to };
}

export function getWeekBounds(weekKey: unknown, fallbackDate = new Date()): WeekBounds {
  const parsed = parseWeekKeyOrThrow(weekKey, fallbackDate);
  const { from, to } = weekKeyToDateRange(parsed);
  return { start: from, end: to };
}

export function buildCreatedAtWeekMatch(weekKey: unknown, fallbackDate = new Date()) {
  const bounds = getWeekBounds(weekKey, fallbackDate);
  return { createdAt: { $gte: bounds.start, $lt: bounds.end } };
}

function parseFromDate(value: string) {
  if (DATE_ONLY_REGEX.test(value)) {
    const [year, month, day] = value.split("-").map((part) => Number(part));
    return new Date(Date.UTC(year, month - 1, day, 0, 0, 0, 0));
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw makeValidationError("Invalid 'from' date.");
  }
  return parsed;
}

function parseToDateExclusive(value: string) {
  if (DATE_ONLY_REGEX.test(value)) {
    const [year, month, day] = value.split("-").map((part) => Number(part));
    return new Date(Date.UTC(year, month - 1, day + 1, 0, 0, 0, 0));
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw makeValidationError("Invalid 'to' date.");
  }
  return parsed;
}

export function resolveRangeFromQuery(url: URL, fallbackDate = new Date()): OpsAnalyticsRange {
  const weekKey = parseWeekKeyOrThrow(url.searchParams.get("weekKey"), fallbackDate);
  const fromRaw = String(url.searchParams.get("from") || "").trim();
  const toRaw = String(url.searchParams.get("to") || "").trim();

  if (fromRaw || toRaw) {
    if (!fromRaw || !toRaw) {
      throw makeValidationError("Both 'from' and 'to' are required for range mode.");
    }

    const from = parseFromDate(fromRaw);
    const to = parseToDateExclusive(toRaw);
    if (from >= to) {
      throw makeValidationError("Invalid range: from must be < to.");
    }

    return {
      mode: "range",
      weekKey,
      from,
      to,
      fromIso: from.toISOString(),
      toIso: to.toISOString(),
    };
  }

  const weekRange = weekKeyToDateRange(weekKey);
  return {
    mode: "week",
    weekKey,
    from: weekRange.from,
    to: weekRange.to,
    fromIso: weekRange.from.toISOString(),
    toIso: weekRange.to.toISOString(),
  };
}

export function buildOrderRangeMatch(range: OpsAnalyticsRange) {
  if (range.mode === "range") {
    return { createdAt: { $gte: range.from, $lt: range.to } };
  }
  return {
    $or: [
      { "settlement.weekKey": range.weekKey },
      {
        $and: [
          { "settlement.weekKey": { $exists: false } },
          { createdAt: { $gte: range.from, $lt: range.to } },
        ],
      },
      {
        $and: [
          { "settlement.weekKey": null },
          { createdAt: { $gte: range.from, $lt: range.to } },
        ],
      },
      {
        $and: [
          { settlement: { $exists: false } },
          { createdAt: { $gte: range.from, $lt: range.to } },
        ],
      },
    ],
  };
}

export function buildRiderPayoutRangeMatch(range: OpsAnalyticsRange) {
  if (range.mode === "range") {
    return { createdAt: { $gte: range.from, $lt: range.to } };
  }
  return { weekKey: range.weekKey };
}

export async function listOpsVisibleCities() {
  const rows = await City.find({ isActive: true })
    .select("_id code slug name country isActive")
    .sort({ name: 1 })
    .lean<
      Array<{
        _id: mongoose.Types.ObjectId;
        code?: string;
        slug?: string;
        name?: string;
        country?: string;
        isActive?: boolean;
      }>
    >();

  const filtered: Array<{
    _id: mongoose.Types.ObjectId;
    code: string;
    slug: string;
    name: string;
    country: string;
  }> = [];

  for (const row of rows) {
    try {
      requireActiveCity({
        isActive: Boolean(row.isActive),
        code: String(row.code || ""),
        name: String(row.name || ""),
        country: String(row.country || ""),
      });
      filtered.push({
        _id: row._id,
        code: cityCode({ code: String(row.code || "") }),
        slug: citySlug({ slug: String(row.slug || ""), name: String(row.name || "") }),
        name: String(row.name || ""),
        country: String(row.country || ""),
      });
    } catch {
      // ignore disabled cities for ops visibility
    }
  }

  return filtered;
}
