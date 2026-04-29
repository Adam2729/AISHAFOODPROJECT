import mongoose from "mongoose";
import { NextResponse } from "next/server";
import { dbConnect } from "@/lib/mongodb";
import { ok, fail, readJson } from "@/lib/apiResponse";
import { assertNotInMaintenance } from "@/lib/maintenance";
import { requireActiveCity, resolveCityFromRequest } from "@/lib/city";
import {
  hashDriverLinkToken,
  setDriverSessionCookie,
  signDriverJwt,
} from "@/lib/driverAuth";
import { ENV_DRIVER_LINK_TTL_HOURS } from "@/lib/env";
import { DriverSessionLink } from "@/models/DriverSessionLink";

type ApiError = Error & { status?: number; code?: string };

type Body = {
  token?: string;
};

export async function POST(req: Request) {
  try {
    await assertNotInMaintenance();
    await dbConnect();

    const body = await readJson<Body>(req);
    const token = String(body.token || "").trim();
    if (!token) {
      return fail("VALIDATION_ERROR", "token is required.", 400);
    }

    const selectedCity = await resolveCityFromRequest(req);
    requireActiveCity({
      isActive: Boolean(selectedCity.isActive),
      code: String(selectedCity.code || ""),
      name: String(selectedCity.name || ""),
      country: String(selectedCity.country || ""),
    });

    const now = new Date();
    const tokenHash = hashDriverLinkToken(token);
    const row = await DriverSessionLink.findOneAndUpdate(
      {
        tokenHash,
        cityId: new mongoose.Types.ObjectId(String(selectedCity._id)),
        usedAt: null,
        expiresAt: { $gt: now },
      },
      { $set: { usedAt: now } },
      { returnDocument: "after" }
    )
      .select("_id cityId driverId")
      .lean<{ _id: mongoose.Types.ObjectId; cityId: mongoose.Types.ObjectId; driverId: mongoose.Types.ObjectId } | null>();

    if (!row) {
      return fail("UNAUTHORIZED", "Invalid, expired, or already-used link.", 401);
    }

    const maxAgeSec = Math.max(60, Math.floor(Number(ENV_DRIVER_LINK_TTL_HOURS || 24) * 60 * 60));
    const jwt = signDriverJwt({
      driverId: String(row.driverId),
      cityId: String(row.cityId),
      ttlSec: maxAgeSec,
    });

    const response = ok({
      driverId: String(row.driverId),
      cityId: String(row.cityId),
    }) as NextResponse;
    setDriverSessionCookie(response, jwt, maxAgeSec);
    return response;
  } catch (error: unknown) {
    const err = error as ApiError;
    return fail(
      err.code || "SERVER_ERROR",
      err.message || "Could not exchange driver session link.",
      err.status || 500
    );
  }
}
