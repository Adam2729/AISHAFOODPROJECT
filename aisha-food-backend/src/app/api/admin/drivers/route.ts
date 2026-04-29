import mongoose from "mongoose";
import { dbConnect } from "@/lib/mongodb";
import { ok, fail, readJson } from "@/lib/apiResponse";
import { requireAdminKey } from "@/lib/adminAuth";
import { getDefaultCity } from "@/lib/city";
import { createDriverLinkToken } from "@/lib/driverLink";
import { normalizePhone, phoneToHash } from "@/lib/phoneHash";
import { getWeekKey } from "@/lib/geo";
import { getClientIp } from "@/lib/rateLimit";
import { hashIp, maskPhone } from "@/lib/pii";
import { Driver } from "@/models/Driver";
import { Order } from "@/models/Order";
import { OpsEvent } from "@/models/OpsEvent";

type ApiError = Error & { status?: number; code?: string };

type DriverDoc = {
  _id: mongoose.Types.ObjectId;
  name: string;
  isActive: boolean;
  isBanned?: boolean;
  bannedReason?: string | null;
  pausedAt?: Date | null;
  pausedReason?: string | null;
  availability?: string | null;
  breakStartedAt?: Date | null;
  breakReason?: string | null;
  breakNote?: string | null;
  lastSeenAt?: Date | null;
  lastLocation?: {
    updatedAt?: Date | null;
  } | null;
  lastDeliveryConfirmedAt?: Date | null;
  cityId?: mongoose.Types.ObjectId | null;
  zoneLabel?: string;
  notes?: string;
  phoneE164?: string | null;
  createdAt?: Date;
  updatedAt?: Date;
};

type CreateDriverBody = {
  name?: string;
  phoneE164?: string;
  isActive?: boolean;
  zoneLabel?: string;
  notes?: string;
  cityId?: string;
};

type UpdateDriverBody = {
  action?: "update" | "reveal_phone" | "generate_link";
  driverId?: string;
  name?: string;
  isActive?: boolean;
  zoneLabel?: string;
  notes?: string;
  phoneE164?: string;
  confirm?: string;
  reason?: string;
  cityId?: string;
  days?: number;
};

function accountStatus(driver: DriverDoc) {
  if (driver.isBanned) return "banned";
  if (driver.pausedAt) return "paused";
  return driver.isActive ? "active" : "inactive";
}

function toDriverRow(driver: DriverDoc, activeAssignedOrderCount = 0) {
  const phoneRaw = String(driver.phoneE164 || "").trim();
  return {
    id: String(driver._id),
    name: String(driver.name || ""),
    isActive: Boolean(driver.isActive),
    isBanned: Boolean((driver as { isBanned?: boolean }).isBanned),
    bannedReason: (driver as { bannedReason?: string | null }).bannedReason || null,
    accountStatus: accountStatus(driver),
    availability: String(driver.availability || "offline"),
    pausedReason: (driver as { pausedReason?: string | null }).pausedReason || null,
    breakStartedAt: driver.breakStartedAt || null,
    breakReason: String(driver.breakReason || "").trim() || null,
    breakNote: String(driver.breakNote || "").trim() || null,
    lastSeenAt: driver.lastSeenAt || null,
    lastLocationUpdatedAt: driver.lastLocation?.updatedAt || null,
    activeAssignedOrderCount,
    lastDeliveryConfirmedAt:
      (driver as { lastDeliveryConfirmedAt?: Date | null }).lastDeliveryConfirmedAt || null,
    cityId: driver.cityId ? String(driver.cityId) : null,
    zoneLabel: String(driver.zoneLabel || "").trim() || null,
    notes: String(driver.notes || "").trim() || null,
    hasPhone: Boolean(phoneRaw),
    phoneMasked: phoneRaw ? maskPhone(phoneRaw) : null,
    createdAt: driver.createdAt || null,
    updatedAt: driver.updatedAt || null,
  };
}

export async function GET(req: Request) {
  try {
    requireAdminKey(req);
    await dbConnect();
    const url = new URL(req.url);
    const cityIdParam = String(url.searchParams.get("cityId") || "").trim();
    const q = url.searchParams.get("q");
    const status = url.searchParams.get("status") || "all";
    const limit = Math.max(1, Math.min(200, Number(url.searchParams.get("limit") || 100)));
    const skip = Math.max(0, Number(url.searchParams.get("skip") || 0));

    if (cityIdParam && !mongoose.Types.ObjectId.isValid(cityIdParam)) {
      return fail("VALIDATION_ERROR", "cityId must be valid.", 400);
    }
    const selectedCity = cityIdParam
      ? { _id: new mongoose.Types.ObjectId(cityIdParam) }
      : await getDefaultCity();

    const filter: Record<string, unknown> = {
      cityId: new mongoose.Types.ObjectId(String(selectedCity._id)),
    };
    if (q) {
      const regex = new RegExp(String(q).trim(), "i");
      filter.$or = [{ name: regex }, { phoneE164: regex }];
    }
    if (status !== "all") {
      if (status === "active") filter.isActive = true;
      if (status === "inactive") filter.isActive = false;
      if (status === "banned") filter.isBanned = true;
    }

    const [drivers, total] = await Promise.all([
      Driver.find(filter)
        .select(
          "_id name phoneE164 cityId isActive isBanned bannedReason pausedAt pausedReason availability breakStartedAt breakReason breakNote lastSeenAt lastLocation.updatedAt lastDeliveryConfirmedAt zoneLabel notes createdAt updatedAt"
        )
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean<DriverDoc[]>(),
      Driver.countDocuments(filter),
    ]);

    const driverIds = drivers.map((row) => row._id);
    const activeCounts = driverIds.length
      ? await Order.aggregate<{ _id: mongoose.Types.ObjectId; count: number }>([
          {
            $match: {
              cityId: new mongoose.Types.ObjectId(String(selectedCity._id)),
              "deliverySnapshot.mode": "platform_driver",
              "dispatch.assignedDriverId": { $in: driverIds },
              status: { $in: ["accepted", "preparing", "ready", "out_for_delivery"] },
            },
          },
          {
            $group: {
              _id: "$dispatch.assignedDriverId",
              count: { $sum: 1 },
            },
          },
        ])
      : [];
    const activeCountByDriverId = new Map(
      activeCounts.map((row) => [String(row._id), Number(row.count || 0)])
    );

    return ok({
      cityId: String(selectedCity._id),
      rows: drivers.map((driver) =>
        toDriverRow(driver, activeCountByDriverId.get(String(driver._id)) || 0)
      ),
      total,
    });
  } catch (error: unknown) {
    const err = error as ApiError;
    return fail(
      err.code || "SERVER_ERROR",
      err.message || "Could not list drivers.",
      err.status || 500
    );
  }
}

export async function POST(req: Request) {
  try {
    requireAdminKey(req);
    const body = await readJson<CreateDriverBody>(req);
    const name = String(body.name || "").trim().slice(0, 80);
    const zoneLabel = String(body.zoneLabel || "").trim().slice(0, 80);
    const notes = String(body.notes || "").trim().slice(0, 280);
    const phoneRaw = String(body.phoneE164 || "").trim();
    const phoneE164 = normalizePhone(phoneRaw);
    const isActive = body.isActive == null ? true : Boolean(body.isActive);
    const cityIdParam = String(body.cityId || "").trim();

    if (!name) return fail("VALIDATION_ERROR", "name is required.", 400);
    if (cityIdParam && !mongoose.Types.ObjectId.isValid(cityIdParam)) {
      return fail("VALIDATION_ERROR", "Valid cityId is required.", 400);
    }

    await dbConnect();
    const selectedCity = cityIdParam
      ? { _id: new mongoose.Types.ObjectId(cityIdParam) }
      : await getDefaultCity();
    const created = await Driver.create({
      name,
      zoneLabel,
      notes,
      phoneE164: phoneE164 || null,
      phoneHash: phoneE164 ? phoneToHash(phoneE164) : "",
      isActive,
      cityId: new mongoose.Types.ObjectId(String(selectedCity._id)),
    });

    try {
      await OpsEvent.create({
        type: "DRIVER_CREATE",
        severity: "low",
        weekKey: getWeekKey(new Date()),
        businessId: null,
        businessName: "dispatch",
        meta: {
          driverId: String(created._id),
        },
      });
    } catch {
      // no-op: operational event should not block driver creation
    }

    return ok(
      {
        driver: toDriverRow(created.toObject() as DriverDoc),
      },
      201
    );
  } catch (error: unknown) {
    const err = error as ApiError;
    return fail(
      err.code || "SERVER_ERROR",
      err.message || "Could not create driver.",
      err.status || 500
    );
  }
}

export async function PATCH(req: Request) {
  try {
    requireAdminKey(req);
    const body = await readJson<UpdateDriverBody>(req);
    const action = String(body.action || "update").trim() as UpdateDriverBody["action"];
    const driverId = String(body.driverId || "").trim();

    if (!mongoose.Types.ObjectId.isValid(driverId)) {
      return fail("VALIDATION_ERROR", "Valid driverId is required.", 400);
    }

    await dbConnect();
    const driver = await Driver.findById(driverId)
      .select("_id name phoneE164 isActive zoneLabel notes createdAt updatedAt")
      .lean<DriverDoc | null>();
    if (!driver) return fail("NOT_FOUND", "Driver not found.", 404);

    if (action === "reveal_phone") {
      const confirm = String(body.confirm || "").trim();
      const reason = String(body.reason || "").trim().slice(0, 200);
      if (confirm !== "REVEAL") {
        return fail("VALIDATION_ERROR", "confirm must be REVEAL.", 400);
      }
      if (reason.length < 10) {
        return fail("VALIDATION_ERROR", "reason must be at least 10 characters.", 400);
      }

      try {
        await OpsEvent.create({
          type: "ADMIN_PII_REVEAL_DRIVER",
          severity: "high",
          weekKey: getWeekKey(new Date()),
          businessId: null,
          businessName: "dispatch",
          meta: {
            driverId: String(driver._id),
            reason,
            adminIpHash: hashIp(getClientIp(req)) || null,
          },
        });
      } catch {
        // no-op: reveal flow returns PII even if observability write fails
      }

      return ok({
        driverId: String(driver._id),
        phoneE164: String(driver.phoneE164 || "").trim() || null,
      });
    }

    if (action === "generate_link") {
      const confirm = String(body.confirm || "").trim();
      if (confirm !== "REVEAL LINK") {
        return fail("VALIDATION_ERROR", "confirm must be REVEAL LINK.", 400);
      }
      const cityIdParam = String(body.cityId || "").trim();
      if (cityIdParam && !mongoose.Types.ObjectId.isValid(cityIdParam)) {
        return fail("VALIDATION_ERROR", "cityId must be valid to generate a driver link.", 400);
      }
      const fallbackCityId =
        driver.cityId && mongoose.Types.ObjectId.isValid(String(driver.cityId))
          ? String(driver.cityId)
          : String((await getDefaultCity())._id);
      const cityId = cityIdParam || fallbackCityId;
      const days = Math.max(1, Math.min(30, Math.floor(Number(body.days || 7))));
      const token = createDriverLinkToken(String(driver._id), cityId, days);
      const origin = new URL(req.url).origin;
      const url = `${origin}/api/driver/orders?token=${encodeURIComponent(token)}&cityId=${encodeURIComponent(
        cityId
      )}`;
      const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
      return ok({
        driverId: String(driver._id),
        token,
        url,
        expiresAt,
      });
    }

    const name = String(body.name ?? driver.name ?? "").trim().slice(0, 80);
    const zoneLabel = String(body.zoneLabel ?? driver.zoneLabel ?? "").trim().slice(0, 80);
    const notes = String(body.notes ?? driver.notes ?? "").trim().slice(0, 280);
    const isActive = body.isActive == null ? Boolean(driver.isActive) : Boolean(body.isActive);

    const next: Record<string, unknown> = {
      name,
      zoneLabel,
      notes,
      isActive,
    };

    if (body.phoneE164 != null) {
      const normalized = normalizePhone(String(body.phoneE164 || "").trim());
      next.phoneE164 = normalized || null;
    }

    await Driver.updateOne({ _id: driver._id }, { $set: next });
    const updated = await Driver.findById(driver._id)
      .select("_id name phoneE164 isActive zoneLabel notes createdAt updatedAt")
      .lean<DriverDoc | null>();
    if (!updated) return fail("NOT_FOUND", "Driver not found.", 404);

    try {
      await OpsEvent.create({
        type: "DRIVER_UPDATE",
        severity: "low",
        weekKey: getWeekKey(new Date()),
        businessId: null,
        businessName: "dispatch",
        meta: {
          driverId: String(updated._id),
        },
      });
    } catch {
      // no-op: operational event should not block driver update
    }

    return ok({
      driver: toDriverRow(updated),
    });
  } catch (error: unknown) {
    const err = error as ApiError;
    return fail(
      err.code || "SERVER_ERROR",
      err.message || "Could not update driver.",
      err.status || 500
    );
  }
}
