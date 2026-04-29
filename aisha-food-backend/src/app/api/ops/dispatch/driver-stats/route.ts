import mongoose from "mongoose";
import { ok, fail } from "@/lib/apiResponse";
import { requireAdminKey } from "@/lib/adminAuth";
import { cityCode } from "@/lib/city";
import { resolveDispatchSelectedCity } from "@/lib/dispatchControl";
import { assertNotInMaintenance } from "@/lib/maintenance";
import { dbConnect } from "@/lib/mongodb";
import { Driver } from "@/models/Driver";

type ApiError = Error & { status?: number; code?: string };

export async function GET(req: Request) {
  try {
    requireAdminKey(req);
    await assertNotInMaintenance();

    const url = new URL(req.url);
    const selectedCity = await resolveDispatchSelectedCity(req, url.searchParams.get("cityId"));
    const cityObjectId = new mongoose.Types.ObjectId(String(selectedCity._id));

    await dbConnect();

    const rows = await Driver.aggregate<{
      _id: string | null;
      count?: number;
    }>([
      {
        $match: {
          cityId: cityObjectId,
          isActive: true,
          isBanned: { $ne: true },
        },
      },
      {
        $group: {
          _id: { $ifNull: ["$availability", "offline"] },
          count: { $sum: 1 },
        },
      },
    ]);

    const counts = new Map(rows.map((row) => [String(row._id || "offline"), Number(row.count || 0)]));

    return ok({
      cityId: String(selectedCity._id),
      cityCode: cityCode(selectedCity),
      availableDrivers: counts.get("available") || 0,
      busyDrivers: counts.get("busy") || 0,
      offlineDrivers: counts.get("offline") || 0,
      totalDrivers:
        (counts.get("available") || 0) +
        (counts.get("busy") || 0) +
        (counts.get("offline") || 0),
    });
  } catch (error: unknown) {
    const err = error as ApiError;
    return fail(
      err.code || "SERVER_ERROR",
      err.message || "Could not load driver stats.",
      err.status || 500
    );
  }
}
