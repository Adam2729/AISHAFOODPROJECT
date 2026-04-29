import mongoose from "mongoose";
import { dbConnect } from "@/lib/mongodb";
import { ok, fail } from "@/lib/apiResponse";
import { assertNotInMaintenance } from "@/lib/maintenance";
import { requireAdminKey } from "@/lib/adminAuth";
import { Driver } from "@/models/Driver";
import { OpsDriverAudit } from "@/models/OpsDriverAudit";

type ApiError = Error & { status?: number; code?: string };

async function loadDriver(driverId: string) {
  if (!mongoose.Types.ObjectId.isValid(driverId)) return null;
  return Driver.findById(new mongoose.Types.ObjectId(driverId))
    .select("_id cityId isActive isBanned bannedAt bannedReason pausedAt pausedReason")
    .lean<{
      _id: mongoose.Types.ObjectId;
      cityId?: mongoose.Types.ObjectId | null;
      isActive?: boolean;
      isBanned?: boolean;
      bannedAt?: Date | null;
      bannedReason?: string | null;
      pausedAt?: Date | null;
      pausedReason?: string | null;
    } | null>();
}

export async function POST(
  req: Request,
  context: { params: Promise<{ driverId: string }> }
) {
  try {
    requireAdminKey(req);
    await assertNotInMaintenance();
    await dbConnect();

    const { driverId } = await context.params;
    const url = new URL(req.url);
    const cityId = url.searchParams.get("cityId");
    if (!cityId || !mongoose.Types.ObjectId.isValid(cityId)) {
      return fail("VALIDATION_ERROR", "cityId is required and must be valid.", 400);
    }

    const driver = await loadDriver(driverId);
    if (!driver) return fail("NOT_FOUND", "Driver not found.", 404);

    const cityObjId = new mongoose.Types.ObjectId(cityId);
    if (!driver.cityId) {
      await Driver.updateOne({ _id: driver._id }, { $set: { cityId: cityObjId } });
      driver.cityId = cityObjId;
    } else if (String(driver.cityId || "") !== String(cityId)) {
      return fail("OUT_OF_SCOPE_CITY", "Driver not in selected city.", 403);
    }

    const before = { isBanned: driver.isBanned, bannedAt: driver.bannedAt, bannedReason: driver.bannedReason };

    await Driver.updateOne(
      { _id: driver._id },
      { $set: { isBanned: false, bannedAt: null, bannedReason: null } }
    );

    await OpsDriverAudit.create({
      cityId: driver.cityId,
      driverId: driver._id,
      action: "DRIVER_UNBANNED",
      actorAdminId: null,
      meta: {
        reason: null,
        before,
        after: { isBanned: false, bannedAt: null, bannedReason: null, isActive: driver.isActive },
      },
    });

    return ok({
      driverId: String(driver._id),
      cityId,
      isActive: Boolean(driver.isActive),
      isBanned: false,
      bannedAt: null,
      pausedAt: driver.pausedAt || null,
    });
  } catch (error: unknown) {
    const err = error as ApiError;
    return fail(err.code || "SERVER_ERROR", err.message || "Could not unban driver.", err.status || 500);
  }
}
