import mongoose from "mongoose";
import { ok, fail, readJson } from "@/lib/apiResponse";
import { requireAdminKey } from "@/lib/adminAuth";
import { requireActiveCity, resolveCityFromRequest } from "@/lib/city";
import { dbConnect } from "@/lib/mongodb";
import { City } from "@/models/City";
import { IncentiveRule } from "@/models/IncentiveRule";

type ApiError = Error & { status?: number; code?: string };

type IncentiveType = "deliveries_count" | "revenue_amount" | "peak_hours";
type IncentivePeriod = "daily" | "weekly";

type CreateBody = {
  cityId?: string;
  name?: string;
  type?: IncentiveType;
  threshold?: number;
  rewardAmount?: number;
  period?: IncentivePeriod;
  startsAt?: string | null;
  endsAt?: string | null;
  notes?: string | null;
};

type IncentiveRuleLean = {
  _id: mongoose.Types.ObjectId;
  cityId: mongoose.Types.ObjectId;
  name: string;
  type: IncentiveType;
  threshold: number;
  rewardAmount: number;
  period: IncentivePeriod;
  isActive?: boolean;
  startsAt?: Date | null;
  endsAt?: Date | null;
  notes?: string | null;
  createdAt?: Date | null;
  updatedAt?: Date | null;
};

function isIncentiveType(value: unknown): value is IncentiveType {
  return (
    value === "deliveries_count" ||
    value === "revenue_amount" ||
    value === "peak_hours"
  );
}

function isIncentivePeriod(value: unknown): value is IncentivePeriod {
  return value === "daily" || value === "weekly";
}

function parseDateOrNull(value: unknown) {
  if (value == null || String(value).trim().length === 0) return null;
  const parsed = new Date(String(value));
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

function mapRule(rule: IncentiveRuleLean) {
  return {
    ruleId: String(rule._id),
    cityId: String(rule.cityId),
    name: String(rule.name || ""),
    type: rule.type,
    threshold: Number(rule.threshold || 0),
    rewardAmount: Number(rule.rewardAmount || 0),
    period: rule.period,
    isActive: Boolean(rule.isActive),
    startsAt: rule.startsAt ? new Date(rule.startsAt).toISOString() : null,
    endsAt: rule.endsAt ? new Date(rule.endsAt).toISOString() : null,
    notes: rule.notes ? String(rule.notes) : null,
    createdAt: rule.createdAt ? new Date(rule.createdAt).toISOString() : null,
    updatedAt: rule.updatedAt ? new Date(rule.updatedAt).toISOString() : null,
  };
}

export async function GET(req: Request) {
  try {
    requireAdminKey(req);
    await dbConnect();

    const url = new URL(req.url);
    const requestedCityId = String(url.searchParams.get("cityId") || "").trim();
    if (requestedCityId && !mongoose.Types.ObjectId.isValid(requestedCityId)) {
      return fail("VALIDATION_ERROR", "cityId is invalid.", 400);
    }

    const selectedCity = requestedCityId
      ? await City.findById(new mongoose.Types.ObjectId(requestedCityId)).lean()
      : await resolveCityFromRequest(req);
    if (!selectedCity) {
      return fail("CITY_NOT_FOUND", "City not found.", 404);
    }
    requireActiveCity(selectedCity);

    const rows = await IncentiveRule.find({
      cityId: new mongoose.Types.ObjectId(String(selectedCity._id)),
    })
      .sort({ isActive: -1, createdAt: -1, _id: -1 })
      .lean<IncentiveRuleLean[]>();

    return ok({
      cityId: String(selectedCity._id),
      rows: rows.map(mapRule),
    });
  } catch (error: unknown) {
    const err = error as ApiError;
    return fail(
      err.code || "SERVER_ERROR",
      err.message || "Could not load incentive rules.",
      err.status || 500
    );
  }
}

export async function POST(req: Request) {
  try {
    requireAdminKey(req);
    const body = await readJson<CreateBody>(req);

    const cityId = String(body.cityId || "").trim();
    const name = String(body.name || "").trim().slice(0, 120);
    const type = String(body.type || "").trim() as IncentiveType;
    const period = String(body.period || "").trim() as IncentivePeriod;
    const threshold = Number(body.threshold || 0);
    const rewardAmount = Number(body.rewardAmount || 0);
    const startsAt = parseDateOrNull(body.startsAt);
    const endsAt = parseDateOrNull(body.endsAt);
    const notes = String(body.notes || "").trim().slice(0, 280) || null;

    if (!mongoose.Types.ObjectId.isValid(cityId)) {
      return fail("VALIDATION_ERROR", "Valid cityId is required.", 400);
    }
    if (!name) {
      return fail("VALIDATION_ERROR", "name is required.", 400);
    }
    if (!isIncentiveType(type)) {
      return fail("VALIDATION_ERROR", "type is invalid.", 400);
    }
    if (!isIncentivePeriod(period)) {
      return fail("VALIDATION_ERROR", "period is invalid.", 400);
    }
    if (!Number.isFinite(threshold) || threshold <= 0) {
      return fail("VALIDATION_ERROR", "threshold must be greater than 0.", 400);
    }
    if (!Number.isFinite(rewardAmount) || rewardAmount <= 0) {
      return fail("VALIDATION_ERROR", "rewardAmount must be greater than 0.", 400);
    }
    if (body.startsAt && !startsAt) {
      return fail("VALIDATION_ERROR", "startsAt is invalid.", 400);
    }
    if (body.endsAt && !endsAt) {
      return fail("VALIDATION_ERROR", "endsAt is invalid.", 400);
    }
    if (startsAt && endsAt && startsAt.getTime() > endsAt.getTime()) {
      return fail("VALIDATION_ERROR", "endsAt must be after startsAt.", 400);
    }

    await dbConnect();

    const selectedCity = await City.findById(new mongoose.Types.ObjectId(cityId)).lean();
    if (!selectedCity) {
      return fail("CITY_NOT_FOUND", "City not found.", 404);
    }
    requireActiveCity(selectedCity);

    const created = await IncentiveRule.create({
      cityId: new mongoose.Types.ObjectId(cityId),
      name,
      type,
      threshold,
      rewardAmount,
      period,
      isActive: true,
      startsAt,
      endsAt,
      notes,
    });

    return ok(
      {
        rule: mapRule(created.toObject() as IncentiveRuleLean),
      },
      201
    );
  } catch (error: unknown) {
    const err = error as ApiError;
    return fail(
      err.code || "SERVER_ERROR",
      err.message || "Could not create incentive rule.",
      err.status || 500
    );
  }
}
