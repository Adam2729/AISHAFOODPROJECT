import mongoose from "mongoose";
import { ok, fail, readJson } from "@/lib/apiResponse";
import { cityCode } from "@/lib/city";
import { requireDriverCityContext } from "@/lib/driverContext";
import { assertNotInMaintenance } from "@/lib/maintenance";
import { dbConnect } from "@/lib/mongodb";
import { Driver } from "@/models/Driver";
import { DriverAudit } from "@/models/DriverAudit";

type ApiError = Error & { status?: number; code?: string };

type AvailabilityValue = "offline" | "available" | "busy" | "paused";

type AvailabilityBody = {
  availability?: AvailabilityValue;
  reason?: string;
  pauseReason?: string;
  note?: string;
};

function isAvailabilityValue(value: unknown): value is AvailabilityValue {
  return value === "offline" || value === "available" || value === "busy" || value === "paused";
}

function normalizePauseReason(body: AvailabilityBody) {
  const raw = String(body.pauseReason || body.reason || "").trim().toLowerCase();
  return ["break", "fuel", "vehicle_issue", "prayer", "other"].includes(raw) ? raw : "break";
}

export async function GET(req: Request) {
  try {
    await assertNotInMaintenance();
    await dbConnect();

    const { city, driver } = await requireDriverCityContext(req);
    const currentDriver = await Driver.findOne({
      _id: new mongoose.Types.ObjectId(String(driver._id)),
      cityId: new mongoose.Types.ObjectId(String(city._id)),
    })
      .select("_id availability lastSeenAt")
      .lean<{
        _id: mongoose.Types.ObjectId;
        availability?: AvailabilityValue;
        lastSeenAt?: Date | null;
      } | null>();

    if (!currentDriver) {
      return fail("NOT_FOUND", "Driver not found in selected city.", 404);
    }

    return ok({
      driverId: String(currentDriver._id),
      city: {
        cityId: String(city._id),
        code: cityCode(city),
        name: String(city.name || ""),
      },
      availability: String(currentDriver.availability || "offline"),
      lastSeenAt: currentDriver.lastSeenAt || null,
    });
  } catch (error: unknown) {
    const err = error as ApiError;
    return fail(
      err.code || "SERVER_ERROR",
      err.message || "Could not load driver availability.",
      err.status || 500
    );
  }
}

export async function POST(req: Request) {
  try {
    await assertNotInMaintenance();
    await dbConnect();

    const { city, driver } = await requireDriverCityContext(req);
    const body = await readJson<AvailabilityBody>(req);
    const availability = String(body.availability || "").trim();

    if (!isAvailabilityValue(availability)) {
      return fail(
        "VALIDATION_ERROR",
        "availability must be one of offline, available, busy, or paused.",
        400
      );
    }

    const cityObjectId = new mongoose.Types.ObjectId(String(city._id));
    const driverObjectId = new mongoose.Types.ObjectId(String(driver._id));

    const currentDriver = await Driver.findOne({
      _id: driverObjectId,
      cityId: cityObjectId,
    })
      .select("_id availability")
      .lean<{ _id: mongoose.Types.ObjectId; availability?: AvailabilityValue } | null>();

    if (!currentDriver) {
      return fail("NOT_FOUND", "Driver not found in selected city.", 404);
    }

    const previousAvailability = String(currentDriver.availability || "offline") as AvailabilityValue;
    const now = new Date();
    const isPaused = availability === "paused";

    await Driver.updateOne(
      {
        _id: driverObjectId,
        cityId: cityObjectId,
      },
      {
        $set: {
          availability,
          breakStartedAt: isPaused ? now : null,
          breakReason: isPaused ? normalizePauseReason(body) : null,
          breakNote: isPaused ? String(body.note || "").trim().slice(0, 200) : "",
          lastSeenAt: now,
        },
      }
    );

    if (previousAvailability !== availability) {
      await DriverAudit.create({
        cityId: cityObjectId,
        driverId: driverObjectId,
        orderId: null,
        action: "AVAILABILITY_CHANGED",
        meta: {
          from: previousAvailability,
          to: availability,
        },
      });
    }

    return ok({
      driverId: String(driverObjectId),
      cityId: String(cityObjectId),
      availability,
    });
  } catch (error: unknown) {
    const err = error as ApiError;
    return fail(
      err.code || "SERVER_ERROR",
      err.message || "Could not update driver availability.",
      err.status || 500
    );
  }
}
