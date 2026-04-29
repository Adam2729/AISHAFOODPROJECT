import mongoose from "mongoose";
import { dbConnect } from "@/lib/mongodb";
import { ok, fail } from "@/lib/apiResponse";
import { requireAdminKey } from "@/lib/adminAuth";
import { assertNotInMaintenance } from "@/lib/maintenance";
import { requireActiveCity, resolveCityFromRequest } from "@/lib/city";
import { createDriverLinkToken } from "@/lib/driverAuth";
import { ENV_DRIVER_LINK_TTL_HOURS } from "@/lib/env";
import { Driver } from "@/models/Driver";
import { DriverSessionLink } from "@/models/DriverSessionLink";

type ApiError = Error & { status?: number; code?: string };

export async function POST(
  req: Request,
  context: { params: Promise<{ driverId: string }> }
) {
  try {
    requireAdminKey(req);
    await assertNotInMaintenance();
    await dbConnect();

    const { driverId } = await context.params;
    if (!mongoose.Types.ObjectId.isValid(driverId)) {
      return fail("VALIDATION_ERROR", "Valid driverId is required.", 400);
    }

    const selectedCity = await resolveCityFromRequest(req);
    requireActiveCity({
      isActive: Boolean(selectedCity.isActive),
      code: String(selectedCity.code || ""),
      name: String(selectedCity.name || ""),
      country: String(selectedCity.country || ""),
    });

    const driver = await Driver.findById(driverId).select("_id name isActive").lean<{
      _id: mongoose.Types.ObjectId;
      name?: string;
      isActive?: boolean;
    } | null>();
    if (!driver || !driver.isActive) {
      return fail("NOT_FOUND", "Driver not available.", 404);
    }

    const ttlHours = Math.max(1, Math.min(168, Number(ENV_DRIVER_LINK_TTL_HOURS || 24)));
    const { token, tokenHash } = createDriverLinkToken();
    const expiresAt = new Date(Date.now() + ttlHours * 60 * 60 * 1000);

    await DriverSessionLink.create({
      cityId: selectedCity._id,
      driverId: driver._id,
      tokenHash,
      expiresAt,
      createdByAdminId: "admin_key",
    });

    const origin = new URL(req.url).origin;
    const linkUrl = `${origin}/driver/link?token=${encodeURIComponent(token)}&cityId=${encodeURIComponent(
      String(selectedCity._id)
    )}`;
    const whatsappText =
      `New delivery shift link (valid ${ttlHours}h): ${linkUrl}\n` +
      "Open it to see your jobs and update status.";

    return ok({
      driverId: String(driver._id),
      driverName: String(driver.name || ""),
      cityId: String(selectedCity._id),
      linkUrl,
      whatsappText,
      expiresAt: expiresAt.toISOString(),
    });
  } catch (error: unknown) {
    const err = error as ApiError;
    return fail(
      err.code || "SERVER_ERROR",
      err.message || "Could not create driver session link.",
      err.status || 500
    );
  }
}
