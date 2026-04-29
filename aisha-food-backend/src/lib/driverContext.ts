import mongoose from "mongoose";
import { dbConnect } from "@/lib/mongodb";
import { requireActiveCity, resolveCityFromRequest } from "@/lib/city";
import { getDriverSessionFromRequest } from "@/lib/driverAuth";
import { requireDriverFromToken } from "@/lib/driverTokenAuth";
import { City } from "@/models/City";
import { Driver } from "@/models/Driver";

type ApiError = Error & { status?: number; code?: string };

function makeError(code: string, message: string, status: number): ApiError {
  const err = new Error(message) as ApiError;
  err.code = code;
  err.status = status;
  return err;
}

export async function requireDriverCityContext(req: Request) {
  const url = new URL(req.url);
  const hasCitySelector =
    Boolean(url.searchParams.get("city")) ||
    Boolean(url.searchParams.get("cityId")) ||
    Boolean(req.headers.get("x-city")) ||
    Boolean(req.headers.get("x-city-id"));

  const session = getDriverSessionFromRequest(req);

  // Resolve city: prefer explicit selector; otherwise fall back to session city; otherwise token city later.
  let city: Awaited<ReturnType<typeof resolveCityFromRequest>> | null = null;
  if (hasCitySelector) {
    city = await resolveCityFromRequest(req);
  } else if (session?.cityId && mongoose.Types.ObjectId.isValid(String(session.cityId))) {
    await dbConnect();
    city = await City.findById(new mongoose.Types.ObjectId(String(session.cityId))).lean();
  }

  if (session?.driverId && session?.cityId) {
    if (!city) {
      throw makeError("CITY_NOT_FOUND", "City not found.", 404);
    }
    requireActiveCity({
      isActive: Boolean((city as { isActive?: boolean }).isActive),
      code: String((city as { code?: string }).code || ""),
      name: String((city as { name?: string }).name || ""),
      country: String((city as { country?: string }).country || ""),
    });

    if (String(session.cityId) !== String((city as { _id?: mongoose.Types.ObjectId })._id)) {
      throw makeError("OUT_OF_SCOPE_CITY", "Driver session city does not match selected city.", 403);
    }

    const driver = await Driver.findById(new mongoose.Types.ObjectId(String(session.driverId)))
      .select("_id name phoneE164 email vehicleType isActive isBanned pausedAt pausedReason breakStartedAt breakReason breakNote zoneLabel availability lastSeenAt lastLocation")
      .lean<{
        _id: mongoose.Types.ObjectId;
        name: string;
        isActive?: boolean;
        isBanned?: boolean;
        pausedAt?: Date | null;
        pausedReason?: string | null;
        phoneE164?: string | null;
        email?: string | null;
        vehicleType?: string | null;
        zoneLabel?: string;
        availability?: "offline" | "available" | "busy" | "paused";
        breakStartedAt?: Date | null;
        breakReason?: string | null;
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
    if (!driver || !driver.isActive || driver.isBanned) {
      throw makeError("DRIVER_NOT_AVAILABLE", "Driver not available.", 403);
    }

    return {
      authMode: "session" as const,
      driver,
      city,
    };
  }

  const driverFromToken = await requireDriverFromToken(req);
  if (!city) {
    await dbConnect();
    city = await City.findById(new mongoose.Types.ObjectId(String(driverFromToken.tokenCityId))).lean();
  }
  if (!city) {
    throw makeError("CITY_NOT_FOUND", "City not found.", 404);
  }
  requireActiveCity({
    isActive: Boolean((city as { isActive?: boolean }).isActive),
    code: String((city as { code?: string }).code || ""),
    name: String((city as { name?: string }).name || ""),
    country: String((city as { country?: string }).country || ""),
  });
  if (String(driverFromToken.tokenCityId) !== String((city as { _id?: mongoose.Types.ObjectId })._id)) {
    throw makeError("OUT_OF_SCOPE_CITY", "Driver token city does not match selected city.", 403);
  }
  return {
    authMode: "token" as const,
    driver: driverFromToken.driver,
    city,
  };
}
