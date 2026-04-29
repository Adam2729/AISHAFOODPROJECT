import mongoose from "mongoose";
import { ok, fail, readJson } from "@/lib/apiResponse";
import { cityCode } from "@/lib/city";
import { requireDriverCityContext } from "@/lib/driverContext";
import { assertNotInMaintenance } from "@/lib/maintenance";
import { dbConnect } from "@/lib/mongodb";
import { Driver } from "@/models/Driver";
import { DriverAudit } from "@/models/DriverAudit";
import { Order } from "@/models/Order";

type ApiError = Error & { status?: number; code?: string };

type DriverAvailability = "offline" | "available" | "busy" | "paused";
type PauseReason = "break" | "fuel" | "vehicle_issue" | "prayer" | "other";

type StatusBody = {
  status?: string;
  availability?: string;
  reason?: string;
  pauseReason?: string;
  note?: string;
};

const ACTIVE_DRIVER_ORDER_STATUSES = ["accepted", "preparing", "ready", "out_for_delivery"];
const PAUSE_REASONS = new Set<PauseReason>([
  "break",
  "fuel",
  "vehicle_issue",
  "prayer",
  "other",
]);

function normalizeRequestedAvailability(body: StatusBody): DriverAvailability | null {
  const raw = String(body.status || body.availability || "").trim().toLowerCase();
  if (raw === "online" || raw === "available") return "available";
  if (raw === "paused" || raw === "pause" || raw === "break") return "paused";
  if (raw === "offline") return "offline";
  return null;
}

function normalizePauseReason(body: StatusBody): PauseReason {
  const raw = String(body.pauseReason || body.reason || "").trim().toLowerCase();
  return PAUSE_REASONS.has(raw as PauseReason) ? (raw as PauseReason) : "break";
}

function accountStatus(driver: {
  isActive?: boolean;
  isBanned?: boolean;
  pausedAt?: Date | null;
}) {
  if (driver.isBanned) return "banned";
  if (driver.pausedAt) return "paused";
  return driver.isActive ? "active" : "inactive";
}

function publicStatus(availability: unknown) {
  const value = String(availability || "offline");
  if (value === "available") return "online";
  if (value === "paused") return "paused";
  return value === "busy" ? "busy" : "offline";
}

async function activeAssignedOrdersCount(input: {
  cityId: mongoose.Types.ObjectId;
  driverId: mongoose.Types.ObjectId;
}) {
  return Order.countDocuments({
    cityId: input.cityId,
    "deliverySnapshot.mode": "platform_driver",
    "dispatch.assignedDriverId": input.driverId,
    status: { $in: ACTIVE_DRIVER_ORDER_STATUSES },
  });
}

async function loadDriver(input: {
  cityId: mongoose.Types.ObjectId;
  driverId: mongoose.Types.ObjectId;
}) {
  return Driver.findOne({
    _id: input.driverId,
    cityId: input.cityId,
  })
    .select("_id isActive isBanned pausedAt pausedReason breakStartedAt breakReason breakNote availability lastSeenAt lastLocation")
    .lean<{
      _id: mongoose.Types.ObjectId;
      isActive?: boolean;
      isBanned?: boolean;
      pausedAt?: Date | null;
      pausedReason?: string | null;
      availability?: DriverAvailability;
      breakStartedAt?: Date | null;
      breakReason?: PauseReason | null;
      breakNote?: string | null;
      lastSeenAt?: Date | null;
      lastLocation?: {
        lat?: number | null;
        lng?: number | null;
        accuracy?: number | null;
        heading?: number | null;
        speed?: number | null;
        updatedAt?: Date | null;
      } | null;
    } | null>();
}

function serializeStatus(input: {
  driver: Awaited<ReturnType<typeof loadDriver>>;
  city: { _id?: mongoose.Types.ObjectId; code?: string; name?: string };
  activeOrdersCount: number;
}) {
  const driver = input.driver;
  const availability = String(driver?.availability || "offline") as DriverAvailability;
  const driverAccountStatus = accountStatus(driver || {});

  return {
    driverId: driver?._id ? String(driver._id) : "",
    city: {
      cityId: String(input.city._id || ""),
      code: cityCode(input.city),
      name: String(input.city.name || ""),
    },
    status: publicStatus(availability),
    availability,
    accountStatus: driverAccountStatus,
    eligibleForAvailableOrders:
      driverAccountStatus === "active" &&
      availability === "available" &&
      input.activeOrdersCount === 0,
    activeOrdersCount: input.activeOrdersCount,
    pausedAt: driver?.pausedAt || null,
    pausedReason: String(driver?.pausedReason || "").trim() || null,
    breakStartedAt: driver?.breakStartedAt || null,
    breakReason: String(driver?.breakReason || "").trim() || null,
    breakNote: String(driver?.breakNote || "").trim() || null,
    lastSeenAt: driver?.lastSeenAt || null,
    lastLocation: driver?.lastLocation || null,
  };
}

export async function GET(req: Request) {
  try {
    await assertNotInMaintenance();
    await dbConnect();

    const { city, driver } = await requireDriverCityContext(req);
    const cityId = new mongoose.Types.ObjectId(String(city._id));
    const driverId = new mongoose.Types.ObjectId(String(driver._id));
    const [currentDriver, activeOrdersCount] = await Promise.all([
      loadDriver({ cityId, driverId }),
      activeAssignedOrdersCount({ cityId, driverId }),
    ]);

    if (!currentDriver) {
      return fail("NOT_FOUND", "Driver not found in selected city.", 404);
    }

    return ok(serializeStatus({ driver: currentDriver, city, activeOrdersCount }));
  } catch (error: unknown) {
    const err = error as ApiError;
    return fail(
      err.code || "SERVER_ERROR",
      err.message || "Could not load driver status.",
      err.status || 500
    );
  }
}

export async function POST(req: Request) {
  try {
    await assertNotInMaintenance();
    await dbConnect();

    const { city, driver } = await requireDriverCityContext(req);
    const body = await readJson<StatusBody>(req);
    const requestedAvailability = normalizeRequestedAvailability(body);
    if (!requestedAvailability) {
      return fail("VALIDATION_ERROR", "status must be online, offline, or paused.", 400);
    }

    const cityId = new mongoose.Types.ObjectId(String(city._id));
    const driverId = new mongoose.Types.ObjectId(String(driver._id));
    const [currentDriver, activeOrdersCount] = await Promise.all([
      loadDriver({ cityId, driverId }),
      activeAssignedOrdersCount({ cityId, driverId }),
    ]);

    if (!currentDriver) {
      return fail("NOT_FOUND", "Driver not found in selected city.", 404);
    }
    const driverAccountStatus = accountStatus(currentDriver);
    if (
      (requestedAvailability === "available" || requestedAvailability === "paused") &&
      driverAccountStatus !== "active"
    ) {
      return fail("DRIVER_NOT_ELIGIBLE", "Driver account is not eligible to update availability.", 409);
    }

    const nextAvailability: DriverAvailability =
      requestedAvailability === "available" && activeOrdersCount > 0
        ? "busy"
        : requestedAvailability;
    const previousAvailability = String(currentDriver.availability || "offline") as DriverAvailability;
    const now = new Date();
    const breakReason =
      requestedAvailability === "paused" ? normalizePauseReason(body) : null;
    const breakNote = String(body.note || "").trim().slice(0, 200);
    const setUpdate: Record<string, unknown> = {
      availability: nextAvailability,
      lastSeenAt: now,
      breakStartedAt: requestedAvailability === "paused" ? now : null,
      breakReason,
      breakNote: requestedAvailability === "paused" ? breakNote : "",
    };

    const updated = await Driver.findOneAndUpdate(
      {
        _id: driverId,
        cityId,
        isActive: true,
        isBanned: { $ne: true },
      },
      {
        $set: setUpdate,
      },
      { new: true }
    )
      .select("_id isActive isBanned pausedAt pausedReason breakStartedAt breakReason breakNote availability lastSeenAt lastLocation")
      .lean<Awaited<ReturnType<typeof loadDriver>>>();

    if (!updated) {
      return fail("DRIVER_NOT_ELIGIBLE", "Driver account is not eligible for status updates.", 409);
    }

    if (previousAvailability !== nextAvailability) {
      await DriverAudit.create({
        cityId,
        driverId,
        orderId: null,
        action: "AVAILABILITY_CHANGED",
        meta: {
          from: previousAvailability,
          to: nextAvailability,
          requestedStatus: String(body.status || body.availability || ""),
          activeOrdersCount,
          pauseReason: breakReason,
        },
      });
    }

    return ok(serializeStatus({ driver: updated, city, activeOrdersCount }));
  } catch (error: unknown) {
    const err = error as ApiError;
    return fail(
      err.code || "SERVER_ERROR",
      err.message || "Could not update driver status.",
      err.status || 500
    );
  }
}
