import mongoose from "mongoose";
import { dbConnect } from "@/lib/mongodb";
import { ok, fail, readJson } from "@/lib/apiResponse";
import { requireAdminKey } from "@/lib/adminAuth";
import { getDefaultCity } from "@/lib/city";
import { createDriverSessionLink, generateTemporaryDriverPassword } from "@/lib/driverAdmin";
import { hashDriverPassword, normalizeDriverEmail } from "@/lib/driverCredentials";
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
  email?: string | null;
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
  zoneLabel?: string | null;
  notes?: string | null;
  phoneE164?: string | null;
  phoneHash?: string | null;
  auth?: {
    lastLoginAt?: Date | null;
  } | null;
  createdAt?: Date;
  updatedAt?: Date;
};

type CreateDriverBody = {
  name?: string;
  email?: string;
  phoneE164?: string;
  isActive?: boolean;
  zoneLabel?: string;
  notes?: string;
  cityId?: string;
  vehicleType?: string;
};

type UpdateDriverBody = {
  action?: "update" | "reveal_phone" | "generate_link";
  driverId?: string;
  name?: string;
  email?: string;
  isActive?: boolean;
  zoneLabel?: string;
  notes?: string;
  phoneE164?: string;
  reason?: string;
  cityId?: string;
};

function accountStatus(driver: DriverDoc) {
  if (driver.isBanned) return "banned";
  if (driver.pausedAt) return "paused";
  return driver.isActive ? "active" : "inactive";
}

function normalizeSearch(value: unknown) {
  return String(value || "").trim().toLowerCase();
}

function isLikelyTestDriver(driver: DriverDoc) {
  const haystack = [
    driver.name,
    driver.email,
    driver.zoneLabel,
    driver.notes,
    driver.phoneE164,
  ]
    .map((value) => normalizeSearch(value))
    .join(" ");
  return (
    haystack.includes("test") ||
    haystack.includes("demo") ||
    haystack.includes("aisha test driver") ||
    haystack.includes("driver@aishafood.com") ||
    haystack.includes("70000000")
  );
}

function buildDriverDedupeKey(driver: DriverDoc) {
  const phoneHash = String(driver.phoneHash || "").trim();
  if (phoneHash) return `phone:${phoneHash}`;
  const email = normalizeDriverEmail(driver.email);
  if (email) return `email:${email}`;
  if (isLikelyTestDriver(driver)) {
    return `test:${normalizeSearch(driver.name)}:${String(driver.cityId || "")}`;
  }
  return "";
}

function driverPriorityScore(driver: DriverDoc, activeAssignedOrderCount: number) {
  const account = accountStatus(driver);
  return [
    account === "active" ? 1000 : 0,
    activeAssignedOrderCount > 0 ? 500 : 0,
    String(driver.availability || "") === "available" ? 250 : 0,
    driver.auth?.lastLoginAt ? 100 : 0,
    driver.lastSeenAt ? 50 : 0,
    driver.lastLocation?.updatedAt ? 25 : 0,
    Number(driver.createdAt ? new Date(driver.createdAt).getTime() : 0) / 1_000_000_000_000,
  ].reduce((sum, value) => sum + value, 0);
}

function shouldHideByDefault(driver: DriverDoc, activeAssignedOrderCount: number) {
  if (!isLikelyTestDriver(driver)) return false;
  if (driver.isActive) return false;
  if (activeAssignedOrderCount > 0) return false;
  if (driver.auth?.lastLoginAt || driver.lastSeenAt || driver.lastLocation?.updatedAt) return false;
  return true;
}

function toDriverRow(driver: DriverDoc, activeAssignedOrderCount = 0) {
  const phoneRaw = String(driver.phoneE164 || "").trim();
  return {
    id: String(driver._id),
    name: String(driver.name || ""),
    email: String(driver.email || "").trim() || null,
    isActive: Boolean(driver.isActive),
    isBanned: Boolean(driver.isBanned),
    bannedReason: driver.bannedReason || null,
    accountStatus: accountStatus(driver),
    availability: String(driver.availability || "offline"),
    pausedReason: driver.pausedReason || null,
    breakStartedAt: driver.breakStartedAt || null,
    breakReason: String(driver.breakReason || "").trim() || null,
    breakNote: String(driver.breakNote || "").trim() || null,
    lastSeenAt: driver.lastSeenAt || null,
    lastLoginAt: driver.auth?.lastLoginAt || null,
    lastLocationUpdatedAt: driver.lastLocation?.updatedAt || null,
    activeAssignedOrderCount,
    lastDeliveryConfirmedAt: driver.lastDeliveryConfirmedAt || null,
    cityId: driver.cityId ? String(driver.cityId) : null,
    zoneLabel: String(driver.zoneLabel || "").trim() || null,
    notes: String(driver.notes || "").trim() || null,
    hasPhone: Boolean(phoneRaw),
    phoneMasked: phoneRaw ? maskPhone(phoneRaw) : null,
    isTestLike: isLikelyTestDriver(driver),
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
    const q = String(url.searchParams.get("q") || "").trim();
    const status = String(url.searchParams.get("status") || "all").trim();
    const includeHidden =
      String(url.searchParams.get("includeHidden") || "").trim() === "1" ||
      String(url.searchParams.get("showInactiveTestDrivers") || "").trim() === "1";
    const limit = Math.max(1, Math.min(500, Number(url.searchParams.get("limit") || 200)));

    if (cityIdParam && !mongoose.Types.ObjectId.isValid(cityIdParam)) {
      return fail("VALIDATION_ERROR", "cityId must be valid.", 400);
    }
    if (!["all", "active", "inactive", "banned"].includes(status)) {
      return fail("VALIDATION_ERROR", "status must be all, active, inactive, or banned.", 400);
    }

    const selectedCity = cityIdParam
      ? { _id: new mongoose.Types.ObjectId(cityIdParam) }
      : await getDefaultCity();

    const filter: Record<string, unknown> = {
      cityId: new mongoose.Types.ObjectId(String(selectedCity._id)),
    };
    if (q) {
      const regex = new RegExp(q, "i");
      filter.$or = [{ name: regex }, { email: regex }, { phoneE164: regex }, { zoneLabel: regex }];
    }
    if (status === "active") filter.isActive = true;
    if (status === "inactive") filter.isActive = false;
    if (status === "banned") filter.isBanned = true;

    const drivers = await Driver.find(filter)
      .select(
        "_id name email phoneE164 phoneHash cityId isActive isBanned bannedReason pausedAt pausedReason availability breakStartedAt breakReason breakNote lastSeenAt lastLocation.updatedAt lastDeliveryConfirmedAt zoneLabel notes auth.lastLoginAt createdAt updatedAt"
      )
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean<DriverDoc[]>();

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

    const hiddenIds = new Set<string>();
    const grouped = new Map<string, DriverDoc[]>();
    for (const driver of drivers) {
      const key = buildDriverDedupeKey(driver);
      if (!key) continue;
      const existing = grouped.get(key) || [];
      existing.push(driver);
      grouped.set(key, existing);
    }

    if (!includeHidden) {
      for (const group of grouped.values()) {
        if (group.length < 2) continue;
        const ordered = [...group].sort((a, b) => {
          const aScore = driverPriorityScore(
            a,
            activeCountByDriverId.get(String(a._id)) || 0
          );
          const bScore = driverPriorityScore(
            b,
            activeCountByDriverId.get(String(b._id)) || 0
          );
          return bScore - aScore;
        });
        for (const duplicate of ordered.slice(1)) {
          hiddenIds.add(String(duplicate._id));
        }
      }
    }

    const visibleDrivers = drivers.filter((driver) => {
      const activeAssignedOrderCount = activeCountByDriverId.get(String(driver._id)) || 0;
      if (includeHidden) return true;
      if (hiddenIds.has(String(driver._id))) return false;
      if (shouldHideByDefault(driver, activeAssignedOrderCount)) return false;
      return true;
    });

    return ok({
      cityId: String(selectedCity._id),
      rows: visibleDrivers.map((driver) =>
        toDriverRow(driver, activeCountByDriverId.get(String(driver._id)) || 0)
      ),
      total: visibleDrivers.length,
      hiddenCount: drivers.length - visibleDrivers.length,
      includeHidden,
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
    const email = normalizeDriverEmail(body.email).slice(0, 120);
    const zoneLabel = String(body.zoneLabel || "").trim().slice(0, 80);
    const notes = String(body.notes || "").trim().slice(0, 280);
    const phoneE164 = String(body.phoneE164 || "").trim();
    const isActive = body.isActive == null ? true : Boolean(body.isActive);
    const cityIdParam = String(body.cityId || "").trim();
    const vehicleType = String(body.vehicleType || "").trim().slice(0, 40);

    if (!name) return fail("VALIDATION_ERROR", "name is required.", 400);
    if (cityIdParam && !mongoose.Types.ObjectId.isValid(cityIdParam)) {
      return fail("VALIDATION_ERROR", "Valid cityId is required.", 400);
    }

    await dbConnect();
    const selectedCity = cityIdParam
      ? { _id: new mongoose.Types.ObjectId(cityIdParam) }
      : await getDefaultCity();
    const temporaryPassword = generateTemporaryDriverPassword();
    const created = await Driver.create({
      name,
      email: email || null,
      zoneLabel,
      notes,
      phoneE164: phoneE164 || null,
      isActive,
      cityId: new mongoose.Types.ObjectId(String(selectedCity._id)),
      vehicleType: vehicleType || null,
      availability: "offline",
      auth: {
        passwordHash: hashDriverPassword(temporaryPassword),
        passwordSetAt: new Date(),
      },
    });
    const sessionLink = await createDriverSessionLink({
      driverId: created._id,
      cityId: selectedCity._id,
      origin: new URL(req.url).origin,
      createdByAdminId: "admin_key",
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
        temporaryPassword,
        loginLink: sessionLink.linkUrl,
        loginLinkExpiresAt: sessionLink.expiresAt,
        loginLinkWhatsappText: sessionLink.whatsappText,
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
      .select(
        "_id name email phoneE164 phoneHash cityId isActive isBanned bannedReason pausedAt pausedReason availability breakStartedAt breakReason breakNote lastSeenAt lastLocation.updatedAt lastDeliveryConfirmedAt zoneLabel notes auth.lastLoginAt createdAt updatedAt"
      )
      .lean<DriverDoc | null>();
    if (!driver) return fail("NOT_FOUND", "Driver not found.", 404);

    if (action === "reveal_phone") {
      const reason = String(body.reason || "").trim().slice(0, 200);
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
      const cityIdParam = String(body.cityId || "").trim();
      if (cityIdParam && !mongoose.Types.ObjectId.isValid(cityIdParam)) {
        return fail("VALIDATION_ERROR", "cityId must be valid to generate a driver link.", 400);
      }
      const fallbackCityId =
        driver.cityId && mongoose.Types.ObjectId.isValid(String(driver.cityId))
          ? String(driver.cityId)
          : String((await getDefaultCity())._id);
      const cityId = cityIdParam || fallbackCityId;
      const sessionLink = await createDriverSessionLink({
        driverId: driver._id,
        cityId,
        origin: new URL(req.url).origin,
        createdByAdminId: "admin_key",
      });
      return ok({
        driverId: String(driver._id),
        linkUrl: sessionLink.linkUrl,
        expiresAt: sessionLink.expiresAt,
        whatsappText: sessionLink.whatsappText,
      });
    }

    const name = String(body.name ?? driver.name ?? "").trim().slice(0, 80);
    const email = normalizeDriverEmail(body.email ?? driver.email).slice(0, 120);
    const zoneLabel = String(body.zoneLabel ?? driver.zoneLabel ?? "").trim().slice(0, 80);
    const notes = String(body.notes ?? driver.notes ?? "").trim().slice(0, 280);
    const isActive = body.isActive == null ? Boolean(driver.isActive) : Boolean(body.isActive);

    const next: Record<string, unknown> = {
      name,
      email: email || null,
      zoneLabel,
      notes,
      isActive,
    };

    if (body.phoneE164 != null) {
      next.phoneE164 = String(body.phoneE164 || "").trim() || null;
    }

    await Driver.updateOne({ _id: driver._id }, { $set: next });
    const updated = await Driver.findById(driver._id)
      .select(
        "_id name email phoneE164 phoneHash cityId isActive isBanned bannedReason pausedAt pausedReason availability breakStartedAt breakReason breakNote lastSeenAt lastLocation.updatedAt lastDeliveryConfirmedAt zoneLabel notes auth.lastLoginAt createdAt updatedAt"
      )
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
