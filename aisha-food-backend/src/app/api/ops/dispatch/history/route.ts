import mongoose from "mongoose";
import { ok, fail } from "@/lib/apiResponse";
import { requireAdminKey } from "@/lib/adminAuth";
import {
  parseIntegerParam,
  resolveDispatchSelectedCity,
  sameObjectId,
  serializeDispatchMeta,
} from "@/lib/dispatchControl";
import { assertNotInMaintenance } from "@/lib/maintenance";
import { dbConnect } from "@/lib/mongodb";
import { DispatchAudit } from "@/models/DispatchAudit";
import { Driver } from "@/models/Driver";
import { Order } from "@/models/Order";

type ApiError = Error & { status?: number; code?: string };

type DispatchHistoryRow = {
  _id: mongoose.Types.ObjectId;
  orderId?: mongoose.Types.ObjectId | null;
  action?: string;
  actor?: string;
  meta?: Record<string, unknown> | null;
  createdAt?: Date | null;
};

export async function GET(req: Request) {
  try {
    requireAdminKey(req);
    await assertNotInMaintenance();

    const url = new URL(req.url);
    const selectedCity = await resolveDispatchSelectedCity(req, url.searchParams.get("cityId"));
    const orderId = String(url.searchParams.get("orderId") || "").trim();
    const driverId = String(url.searchParams.get("driverId") || "").trim();
    const limit = parseIntegerParam(url.searchParams.get("limit"), {
      defaultValue: 50,
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

    if (orderId && !mongoose.Types.ObjectId.isValid(orderId)) {
      return fail("VALIDATION_ERROR", "Valid orderId is required.", 400);
    }
    if (driverId && !mongoose.Types.ObjectId.isValid(driverId)) {
      return fail("VALIDATION_ERROR", "Valid driverId is required.", 400);
    }

    await dbConnect();

    const cityObjectId = new mongoose.Types.ObjectId(String(selectedCity._id));

    if (orderId) {
      const order = await Order.findById(orderId).select("_id cityId").lean<{
        _id: mongoose.Types.ObjectId;
        cityId?: mongoose.Types.ObjectId | null;
      } | null>();
      if (!order || !sameObjectId(order.cityId, selectedCity._id)) {
        return fail("NOT_FOUND", "Order not found in selected city.", 404);
      }
    }

    if (driverId) {
      const driver = await Driver.findById(driverId).select("_id cityId").lean<{
        _id: mongoose.Types.ObjectId;
        cityId?: mongoose.Types.ObjectId | null;
      } | null>();
      if (!driver || !sameObjectId(driver.cityId, selectedCity._id)) {
        return fail("NOT_FOUND", "Driver not found in selected city.", 404);
      }
    }

    const baseMatch: Record<string, unknown> = {};
    if (orderId) {
      baseMatch.orderId = new mongoose.Types.ObjectId(orderId);
    } else if (driverId) {
      const driverObjectId = new mongoose.Types.ObjectId(driverId);
      baseMatch.$or = [
        { driverId: driverObjectId },
        { "meta.driverId": driverObjectId },
        { "meta.previousDriverId": driverObjectId },
        { "meta.newDriverId": driverObjectId },
      ];
    }

    const rows = await DispatchAudit.aggregate<DispatchHistoryRow>([
      { $match: baseMatch },
      {
        $lookup: {
          from: "orders",
          localField: "orderId",
          foreignField: "_id",
          as: "orderDocs",
        },
      },
      {
        $addFields: {
          resolvedCityId: {
            $ifNull: ["$cityId", { $first: "$orderDocs.cityId" }],
          },
        },
      },
      {
        $match: {
          resolvedCityId: cityObjectId,
        },
      },
      {
        $sort: {
          createdAt: -1,
        },
      },
      { $skip: skip },
      { $limit: limit },
      {
        $project: {
          orderDocs: 0,
          resolvedCityId: 0,
        },
      },
    ]);

    return ok({
      cityId: String(selectedCity._id),
      rows: rows.map((row) => ({
        id: String(row._id),
        orderId: row.orderId ? String(row.orderId) : null,
        action: String(row.action || ""),
        actor: String(row.actor || ""),
        meta: serializeDispatchMeta(row.meta || null),
        createdAt: row.createdAt || null,
      })),
    });
  } catch (error: unknown) {
    const err = error as ApiError;
    return fail(
      err.code || "SERVER_ERROR",
      err.message || "Could not load dispatch history.",
      err.status || 500
    );
  }
}
