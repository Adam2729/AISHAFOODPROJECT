import mongoose from "mongoose";
import { ok, fail } from "@/lib/apiResponse";
import { requireAdminKey } from "@/lib/adminAuth";
import { cityCode } from "@/lib/city";
import { parseIntegerParam, resolveDispatchSelectedCity } from "@/lib/dispatchControl";
import { assertNotInMaintenance } from "@/lib/maintenance";
import { dbConnect } from "@/lib/mongodb";
import { Driver } from "@/models/Driver";
import { Order } from "@/models/Order";

type ApiError = Error & { status?: number; code?: string };

type DriverRow = {
  _id: mongoose.Types.ObjectId;
  name?: string;
  phoneE164?: string | null;
  zoneLabel?: string | null;
  isActive?: boolean;
  isBanned?: boolean;
  availability?: "offline" | "available" | "busy" | "paused";
  lastAssignedAt?: Date | null;
  lastDeliveryConfirmedAt?: Date | null;
};

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export async function GET(req: Request) {
  try {
    requireAdminKey(req);
    await assertNotInMaintenance();

    const url = new URL(req.url);
    const selectedCity = await resolveDispatchSelectedCity(req, url.searchParams.get("cityId"));
    const limit = parseIntegerParam(url.searchParams.get("limit"), {
      defaultValue: 100,
      min: 1,
      max: 200,
      label: "limit",
    });
    const skip = parseIntegerParam(url.searchParams.get("skip"), {
      defaultValue: 0,
      min: 0,
      max: 100000,
      label: "skip",
    });
    const q = String(url.searchParams.get("q") || "").trim();

    await dbConnect();

    const cityObjectId = new mongoose.Types.ObjectId(String(selectedCity._id));
    const filter: Record<string, unknown> = {
      cityId: cityObjectId,
      isActive: true,
      isBanned: { $ne: true },
    };

    if (q) {
      const regex = new RegExp(escapeRegex(q), "i");
      filter.$or = [{ name: regex }, { phoneE164: regex }, { zoneLabel: regex }];
    }

    const [drivers, total] = await Promise.all([
      Driver.find(filter)
        .select("_id name phoneE164 zoneLabel isActive isBanned availability lastAssignedAt lastDeliveryConfirmedAt")
        .sort({ availability: 1, lastAssignedAt: 1, lastDeliveryConfirmedAt: -1, name: 1, createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean<DriverRow[]>(),
      Driver.countDocuments(filter),
    ]);

    const driverIds = drivers.map((row) => row._id).filter(Boolean);
    const activeLoadRows = driverIds.length
      ? await Order.aggregate<{
          _id: mongoose.Types.ObjectId;
          activeLoad?: number;
        }>([
          {
            $match: {
              cityId: cityObjectId,
              status: { $nin: ["delivered", "cancelled"] },
              "dispatch.assignedDriverId": { $in: driverIds },
            },
          },
          {
            $group: {
              _id: "$dispatch.assignedDriverId",
              activeLoad: { $sum: 1 },
            },
          },
        ])
      : [];

    const activeLoadByDriver = new Map(
      activeLoadRows.map((row) => [String(row._id), Number(row.activeLoad || 0)])
    );

    return ok({
      cityId: String(selectedCity._id),
      cityCode: cityCode(selectedCity),
      total,
      rows: drivers.map((row) => ({
        driverId: String(row._id),
        name: String(row.name || ""),
        phone: String(row.phoneE164 || "").trim() || null,
        zoneLabel: String(row.zoneLabel || "").trim() || null,
        isActive: Boolean(row.isActive),
        isBanned: Boolean(row.isBanned),
        availability: String(row.availability || "offline"),
        lastAssignedAt: row.lastAssignedAt || null,
        lastDeliveryConfirmedAt: row.lastDeliveryConfirmedAt || null,
        activeLoad: activeLoadByDriver.get(String(row._id)) || 0,
      })),
    });
  } catch (error: unknown) {
    const err = error as ApiError;
    return fail(
      err.code || "SERVER_ERROR",
      err.message || "Could not load dispatch drivers.",
      err.status || 500
    );
  }
}
