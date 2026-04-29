import mongoose from "mongoose";
import { dbConnect } from "@/lib/mongodb";
import { ok, fail, readJson } from "@/lib/apiResponse";
import { assertNotInMaintenance } from "@/lib/maintenance";
import { requireDriverCityContext } from "@/lib/driverContext";
import { Driver } from "@/models/Driver";

type ApiError = Error & { status?: number; code?: string };

type Body = {
  latitude?: number;
  longitude?: number;
  lat?: number;
  lng?: number;
  accuracy?: number | null;
  heading?: number | null;
  speed?: number | null;
};

function optionalNumber(value: unknown) {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export async function POST(req: Request) {
  try {
    await assertNotInMaintenance();
    await dbConnect();
    const { driver, city } = await requireDriverCityContext(req);
    const body = await readJson<Body>(req);
    const latitude = Number(body.latitude ?? body.lat);
    const longitude = Number(body.longitude ?? body.lng);

    if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) {
      return fail("VALIDATION_ERROR", "latitude must be a valid latitude.", 400);
    }
    if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
      return fail("VALIDATION_ERROR", "longitude must be a valid longitude.", 400);
    }

    const updatedAt = new Date();
    await Driver.updateOne(
      {
        _id: new mongoose.Types.ObjectId(String(driver._id)),
        cityId: new mongoose.Types.ObjectId(String(city._id)),
      },
      {
        $set: {
          lastSeenAt: updatedAt,
          "lastLocation.lat": latitude,
          "lastLocation.lng": longitude,
          "lastLocation.accuracy": optionalNumber(body.accuracy),
          "lastLocation.heading": optionalNumber(body.heading),
          "lastLocation.speed": optionalNumber(body.speed),
          "lastLocation.updatedAt": updatedAt,
        },
      }
    );

    return ok({
      location: {
        latitude,
        longitude,
        lat: latitude,
        lng: longitude,
        accuracy: optionalNumber(body.accuracy),
        heading: optionalNumber(body.heading),
        speed: optionalNumber(body.speed),
        updatedAt,
      },
    });
  } catch (error: unknown) {
    const err = error as ApiError;
    return fail(
      err.code || "SERVER_ERROR",
      err.message || "Could not update driver location.",
      err.status || 500
    );
  }
}
