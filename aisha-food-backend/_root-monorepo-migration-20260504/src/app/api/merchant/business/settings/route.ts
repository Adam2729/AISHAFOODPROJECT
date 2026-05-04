import mongoose from "mongoose";
import { dbConnect } from "@/lib/mongodb";
import { ok, fail, readJson } from "@/lib/apiResponse";
import { requireMerchantSession } from "@/lib/merchantAuth";
import { requireMerchantBusinessAvailable } from "@/lib/merchantBusiness";
import { Business } from "@/models/Business";

type ApiError = Error & { status?: number; code?: string };
type DayKey = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";
type DaySchedule = { open?: string; close?: string; closed?: boolean };
type Body = {
  isManuallyPaused?: boolean;
  hours?: {
    timezone?: string;
    weekly?: Partial<Record<DayKey, DaySchedule>>;
  };
};

const DAY_KEYS: DayKey[] = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const TIME_REGEX = /^([01]\d|2[0-3]):([0-5]\d)$/;

function parseMinutes(value: string) {
  const match = value.match(TIME_REGEX);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

function normalizeWeekly(input: unknown) {
  const weeklyRaw = (input && typeof input === "object" ? input : {}) as Partial<
    Record<DayKey, DaySchedule>
  >;
  const weekly: Record<DayKey, DaySchedule> = {
    mon: { open: "08:00", close: "22:00", closed: false },
    tue: { open: "08:00", close: "22:00", closed: false },
    wed: { open: "08:00", close: "22:00", closed: false },
    thu: { open: "08:00", close: "22:00", closed: false },
    fri: { open: "08:00", close: "22:00", closed: false },
    sat: { open: "08:00", close: "22:00", closed: false },
    sun: { open: "08:00", close: "22:00", closed: false },
  };

  for (const day of DAY_KEYS) {
    const next = weeklyRaw[day];
    if (!next || typeof next !== "object") continue;
    const closed = Boolean(next.closed);
    if (closed) {
      weekly[day] = { closed: true, open: "08:00", close: "22:00" };
      continue;
    }
    const open = String(next.open || "").trim();
    const close = String(next.close || "").trim();
    if (!TIME_REGEX.test(open) || !TIME_REGEX.test(close)) {
      throw new Error(`Invalid time format for ${day}. Use HH:MM.`);
    }
    const openMinutes = parseMinutes(open);
    const closeMinutes = parseMinutes(close);
    if (openMinutes == null || closeMinutes == null || closeMinutes <= openMinutes) {
      throw new Error(`Close must be after open for ${day}.`);
    }
    weekly[day] = { open, close, closed: false };
  }

  return weekly;
}

export async function GET(req: Request) {
  try {
    const session = requireMerchantSession(req);
    await dbConnect();
    await requireMerchantBusinessAvailable(session.businessId);
    const business = await Business.findById(session.businessId)
      .select("name isManuallyPaused busyUntil hours")
      .lean();
    if (!business) return fail("NOT_FOUND", "Business not found.", 404);
    return ok({
      business: {
        id: String(business._id),
        name: business.name,
        isManuallyPaused: Boolean((business as { isManuallyPaused?: boolean }).isManuallyPaused),
        busyUntil: (business as { busyUntil?: Date | null }).busyUntil || null,
        hours: (business as { hours?: unknown }).hours || {
          timezone: "America/Santo_Domingo",
          weekly: {},
        },
      },
    });
  } catch (error: unknown) {
    const err = error as ApiError;
    return fail(
      err.code || "SERVER_ERROR",
      err.message || "Could not load business settings.",
      err.status || 500
    );
  }
}

export async function PATCH(req: Request) {
  try {
    const session = requireMerchantSession(req);
    const body = await readJson<Body>(req);
    const set: Record<string, unknown> = {};

    if (body.isManuallyPaused !== undefined) {
      if (typeof body.isManuallyPaused !== "boolean") {
        return fail("VALIDATION_ERROR", "isManuallyPaused must be boolean.", 400);
      }
      set.isManuallyPaused = body.isManuallyPaused;
    }

    if (body.hours !== undefined) {
      const timezone = String(body.hours?.timezone || "America/Santo_Domingo").trim();
      if (!timezone || timezone.length > 64) {
        return fail("VALIDATION_ERROR", "Invalid timezone.", 400);
      }
      const weekly = normalizeWeekly(body.hours?.weekly);
      set.hours = {
        timezone,
        weekly,
      };
    }

    if (!Object.keys(set).length) {
      return fail("VALIDATION_ERROR", "No valid fields provided.", 400);
    }

    await dbConnect();
    await requireMerchantBusinessAvailable(session.businessId);
    const updated = await Business.findOneAndUpdate(
      { _id: new mongoose.Types.ObjectId(session.businessId) },
      { $set: set },
      { returnDocument: "after" }
    )
      .select("name isManuallyPaused busyUntil hours")
      .lean();
    if (!updated) return fail("NOT_FOUND", "Business not found.", 404);

    return ok({
      business: {
        id: String(updated._id),
        name: updated.name,
        isManuallyPaused: Boolean((updated as { isManuallyPaused?: boolean }).isManuallyPaused),
        busyUntil: (updated as { busyUntil?: Date | null }).busyUntil || null,
        hours: (updated as { hours?: unknown }).hours || null,
      },
    });
  } catch (error: unknown) {
    const err = error as ApiError;
    return fail(
      err.code || "SERVER_ERROR",
      err.message || "Could not update business settings.",
      err.status || 500
    );
  }
}
