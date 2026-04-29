import mongoose from "mongoose";
import { dbConnect } from "@/lib/mongodb";
import { ok, fail, readJson } from "@/lib/apiResponse";
import { assertNotInMaintenance } from "@/lib/maintenance";
import { requireAdminKey } from "@/lib/adminAuth";
import { Driver } from "@/models/Driver";
import { OpsDriverAudit } from "@/models/OpsDriverAudit";

type ApiError = Error & { status?: number; code?: string };

type Body = { reason?: string };

async function loadDriver(driverId: string) {
  if (!mongoose.Types.ObjectId.isValid(driverId)) return null;
  return Driver.findById(driverId)
    .select("_id cityId isActive isBanned pausedAt pausedReason")
    .lean<{
      _id: mongoose.Types.ObjectId;
      cityId?: mongoose.Types.ObjectId | null;
      isActive?: boolean;
      isBanned?: boolean;
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

    const body = await readJson<Body>(req);
    const reason = String(body.reason || "").trim().slice(0, 280) || null;

    const driver = await loadDriver(driverId);
    if (!driver) return fail("NOT_FOUND", "Driver not found.", 404);

    const cityObjId = new mongoose.Types.ObjectId(cityId);
    if (!driver.cityId) {
      await Driver.updateOne({ _id: driver._id }, { $set: { cityId: cityObjId } });
      driver.cityId = cityObjId;
    } else if (String(driver.cityId || "") !== String(cityId)) {
      return fail("OUT_OF_SCOPE_CITY", "Driver not in selected city.", 403);
    }

    const now = new Date();
    const before = { pausedAt: driver.pausedAt, pausedReason: driver.pausedReason };

    await Driver.updateOne(
      { _id: driver._id },
      { $set: { pausedAt: now, pausedReason: reason } }
    );

    await OpsDriverAudit.create({
      cityId: driver.cityId,
      driverId: driver._id,
      action: "DRIVER_PAUSED",
      actorAdminId: null,
      meta: { reason, before, after: { pausedAt: now, pausedReason: reason } },
    });

    return ok({
      driverId: String(driver._id),
      cityId,
      pausedAt: now,
      pausedReason: reason,
      isActive: driver.isActive,
      isBanned: driver.isBanned,
    });
  } catch (error: unknown) {
    const err = error as ApiError;
    return fail(err.code || "SERVER_ERROR", err.message || "Could not pause driver.", err.status || 500);
  }
}
