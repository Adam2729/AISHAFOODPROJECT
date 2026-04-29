import mongoose from "mongoose";
import { dbConnect } from "@/lib/mongodb";
import { ok, fail, readJson } from "@/lib/apiResponse";
import { requireMerchantSession } from "@/lib/merchantAuth";
import { requireMerchantBusinessAvailable } from "@/lib/merchantBusiness";
import { getDefaultTimezoneForCity } from "@/lib/marketConfig";
import { getDefaultDeliveryPolicy } from "@/lib/deliveryPolicy";
import { Business } from "@/models/Business";
import { City } from "@/models/City";

type ApiError = Error & { status?: number; code?: string };
type DayKey = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";
type DaySchedule = { open?: string; close?: string; closed?: boolean };
type Body = {
  name?: string;
  ownerName?: string;
  email?: string | null;
  phone?: string;
  whatsapp?: string;
  address?: string;
  area?: string;
  logoUrl?: string;
  coverImageUrl?: string;
  deliveryType?: "own_driver" | "platform_driver";
  minimumOrderAmount?: number;
  deliveryRadiusKm?: number;
  autoAcceptOrders?: boolean;
  eta?: {
    prepMins?: number;
  };
  payout?: {
    preferredMethod?: "bank_transfer" | "mobile_money" | "cash_collection" | "weekly_cashout";
    details?: string;
    payoutContactName?: string;
  };
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
      .select(
        "name ownerName email phone whatsapp address area logoUrl coverImageUrl deliveryType minimumOrderAmount deliveryRadiusKm autoAcceptOrders eta payout isManuallyPaused busyUntil hours cityId"
      )
      .lean();
    if (!business) return fail("NOT_FOUND", "Business not found.", 404);
    const city =
      (business as { cityId?: mongoose.Types.ObjectId | null }).cityId &&
      mongoose.Types.ObjectId.isValid(String((business as { cityId?: mongoose.Types.ObjectId | null }).cityId))
        ? await City.findById((business as { cityId?: mongoose.Types.ObjectId | null }).cityId)
            .select("code slug name country currency supportWhatsAppE164 paymentMethods")
            .lean()
        : null;
    const defaultTimezone = getDefaultTimezoneForCity(city);
    return ok({
      business: {
        id: String(business._id),
        name: business.name,
        ownerName: (business as { ownerName?: string }).ownerName || "",
        email: (business as { email?: string | null }).email || "",
        phone: (business as { phone?: string }).phone || "",
        whatsapp: (business as { whatsapp?: string }).whatsapp || "",
        address: (business as { address?: string }).address || "",
        area: (business as { area?: string }).area || "",
        logoUrl: (business as { logoUrl?: string }).logoUrl || "",
        coverImageUrl: (business as { coverImageUrl?: string }).coverImageUrl || "",
        deliveryType: (business as { deliveryType?: string }).deliveryType || "own_driver",
        minimumOrderAmount: Number(
          (business as { minimumOrderAmount?: number }).minimumOrderAmount || 0
        ),
        deliveryRadiusKm: Number(
          (business as { deliveryRadiusKm?: number }).deliveryRadiusKm || 0
        ),
        autoAcceptOrders: Boolean(
          (business as { autoAcceptOrders?: boolean }).autoAcceptOrders
        ),
        eta: (business as { eta?: { prepMins?: number } }).eta || { prepMins: 15 },
        payout: (business as { payout?: unknown }).payout || null,
        isManuallyPaused: Boolean((business as { isManuallyPaused?: boolean }).isManuallyPaused),
        busyUntil: (business as { busyUntil?: Date | null }).busyUntil || null,
        hours: (business as { hours?: unknown }).hours || {
          timezone: defaultTimezone,
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
    const unset: Record<string, "" | 1> = {};
    let cityForDefaults:
      | {
          code?: string;
          slug?: string;
          name?: string;
          country?: string;
          currency?: string;
          supportWhatsAppE164?: string;
          paymentMethods?: string[];
        }
      | null = null;

    if (body.name !== undefined) {
      const name = String(body.name || "").trim().slice(0, 120);
      if (!name) return fail("VALIDATION_ERROR", "name is required.", 400);
      set.name = name;
    }
    if (body.ownerName !== undefined) {
      set.ownerName = String(body.ownerName || "").trim().slice(0, 120);
    }
    if (body.email !== undefined) {
      const email = String(body.email || "").trim().toLowerCase();
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return fail("VALIDATION_ERROR", "Invalid email.", 400);
      }
      if (email) {
        set.email = email;
      } else {
        unset.email = "";
      }
    }
    if (body.phone !== undefined) {
      const phone = String(body.phone || "").trim().slice(0, 40);
      if (!phone) return fail("VALIDATION_ERROR", "phone is required.", 400);
      set.phone = phone;
    }
    if (body.whatsapp !== undefined) {
      set.whatsapp = String(body.whatsapp || "").trim().slice(0, 40);
    }
    if (body.address !== undefined) {
      const address = String(body.address || "").trim().slice(0, 200);
      if (!address) return fail("VALIDATION_ERROR", "address is required.", 400);
      set.address = address;
    }
    if (body.area !== undefined) {
      const area = String(body.area || "").trim().slice(0, 120);
      set.area = area;
      set.zoneLabel = area || null;
    }
    if (body.logoUrl !== undefined) {
      set.logoUrl = String(body.logoUrl || "").trim().slice(0, 500);
    }
    if (body.coverImageUrl !== undefined) {
      set.coverImageUrl = String(body.coverImageUrl || "").trim().slice(0, 500);
    }
    if (body.deliveryType !== undefined) {
      if (!["own_driver", "platform_driver"].includes(String(body.deliveryType))) {
        return fail("VALIDATION_ERROR", "deliveryType is invalid.", 400);
      }
      const deliveryPolicy = getDefaultDeliveryPolicy(body.deliveryType);
      set.deliveryType = body.deliveryType;
      set["deliveryPolicy.mode"] = deliveryPolicy.mode;
      set["deliveryPolicy.publicNoteEs"] = deliveryPolicy.publicNoteEs;
      set["deliveryPolicy.updatedAt"] = new Date();
    }
    if (body.minimumOrderAmount !== undefined) {
      const minimumOrderAmount = Number(body.minimumOrderAmount);
      if (!Number.isFinite(minimumOrderAmount) || minimumOrderAmount < 0) {
        return fail("VALIDATION_ERROR", "minimumOrderAmount must be a valid number.", 400);
      }
      set.minimumOrderAmount = minimumOrderAmount;
    }
    if (body.deliveryRadiusKm !== undefined) {
      const deliveryRadiusKm = Number(body.deliveryRadiusKm);
      if (!Number.isFinite(deliveryRadiusKm) || deliveryRadiusKm < 0 || deliveryRadiusKm > 200) {
        return fail("VALIDATION_ERROR", "deliveryRadiusKm is invalid.", 400);
      }
      set.deliveryRadiusKm = deliveryRadiusKm;
    }
    if (body.autoAcceptOrders !== undefined) {
      if (typeof body.autoAcceptOrders !== "boolean") {
        return fail("VALIDATION_ERROR", "autoAcceptOrders must be boolean.", 400);
      }
      set.autoAcceptOrders = body.autoAcceptOrders;
    }
    if (body.eta?.prepMins !== undefined) {
      const prepMins = Number(body.eta.prepMins);
      if (!Number.isFinite(prepMins) || prepMins < 0 || prepMins > 240) {
        return fail("VALIDATION_ERROR", "eta.prepMins is invalid.", 400);
      }
      set["eta.prepMins"] = prepMins;
      set["eta.minMins"] = Math.max(prepMins + 10, 20);
      set["eta.maxMins"] = Math.max(prepMins + 25, 35);
    }
    if (body.payout !== undefined) {
      const preferredMethod = String(body.payout?.preferredMethod || "").trim();
      if (
        preferredMethod &&
        !["bank_transfer", "mobile_money", "cash_collection", "weekly_cashout"].includes(preferredMethod)
      ) {
        return fail("VALIDATION_ERROR", "payout.preferredMethod is invalid.", 400);
      }
      set.payout = {
        preferredMethod: preferredMethod || "cash_collection",
        details: String(body.payout?.details || "").trim().slice(0, 400),
        payoutContactName: String(body.payout?.payoutContactName || "").trim().slice(0, 120),
      };
    }

    if (body.isManuallyPaused !== undefined) {
      if (typeof body.isManuallyPaused !== "boolean") {
        return fail("VALIDATION_ERROR", "isManuallyPaused must be boolean.", 400);
      }
      set.isManuallyPaused = body.isManuallyPaused;
    }

    await dbConnect();
    await requireMerchantBusinessAvailable(session.businessId);
    const existingBusiness = await Business.findById(session.businessId)
      .select("cityId")
      .lean<{ cityId?: mongoose.Types.ObjectId | null } | null>();
    if (!existingBusiness) return fail("NOT_FOUND", "Business not found.", 404);
    cityForDefaults =
      existingBusiness.cityId && mongoose.Types.ObjectId.isValid(String(existingBusiness.cityId))
        ? await City.findById(existingBusiness.cityId)
            .select("code slug name country currency supportWhatsAppE164 paymentMethods")
            .lean()
        : null;

    if (body.hours !== undefined) {
      const timezone = String(
        body.hours?.timezone || getDefaultTimezoneForCity(cityForDefaults)
      ).trim();
      if (!timezone || timezone.length > 64) {
        return fail("VALIDATION_ERROR", "Invalid timezone.", 400);
      }
      const weekly = normalizeWeekly(body.hours?.weekly);
      set.hours = {
        timezone,
        weekly,
      };
    }

    if (!Object.keys(set).length && !Object.keys(unset).length) {
      return fail("VALIDATION_ERROR", "No valid fields provided.", 400);
    }

    const updated = await Business.findOneAndUpdate(
      { _id: new mongoose.Types.ObjectId(session.businessId) },
      {
        ...(Object.keys(set).length ? { $set: set } : {}),
        ...(Object.keys(unset).length ? { $unset: unset } : {}),
      },
      { returnDocument: "after", runValidators: true }
    )
      .select(
        "name ownerName email phone whatsapp address area logoUrl coverImageUrl deliveryType minimumOrderAmount deliveryRadiusKm autoAcceptOrders eta payout isManuallyPaused busyUntil hours"
      )
      .lean();
    if (!updated) return fail("NOT_FOUND", "Business not found.", 404);

    return ok({
      business: {
        id: String(updated._id),
        name: updated.name,
        ownerName: (updated as { ownerName?: string }).ownerName || "",
        email: (updated as { email?: string | null }).email || "",
        phone: (updated as { phone?: string }).phone || "",
        whatsapp: (updated as { whatsapp?: string }).whatsapp || "",
        address: (updated as { address?: string }).address || "",
        area: (updated as { area?: string }).area || "",
        logoUrl: (updated as { logoUrl?: string }).logoUrl || "",
        coverImageUrl: (updated as { coverImageUrl?: string }).coverImageUrl || "",
        deliveryType: (updated as { deliveryType?: string }).deliveryType || "own_driver",
        minimumOrderAmount: Number(
          (updated as { minimumOrderAmount?: number }).minimumOrderAmount || 0
        ),
        deliveryRadiusKm: Number(
          (updated as { deliveryRadiusKm?: number }).deliveryRadiusKm || 0
        ),
        autoAcceptOrders: Boolean(
          (updated as { autoAcceptOrders?: boolean }).autoAcceptOrders
        ),
        eta: (updated as { eta?: unknown }).eta || null,
        payout: (updated as { payout?: unknown }).payout || null,
        isManuallyPaused: Boolean((updated as { isManuallyPaused?: boolean }).isManuallyPaused),
        busyUntil: (updated as { busyUntil?: Date | null }).busyUntil || null,
        hours: (updated as { hours?: unknown }).hours || null,
      },
    });
  } catch (error: unknown) {
    const err = error as ApiError;
    if ((err as { code?: number }).code === 11000) {
      return fail("CONFLICT", "Email is already used by another business.", 409);
    }
    return fail(
      err.code || "SERVER_ERROR",
      err.message || "Could not update business settings.",
      err.status || 500
    );
  }
}
