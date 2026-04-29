import mongoose from "mongoose";
import { dbConnect } from "@/lib/mongodb";
import { ok, fail } from "@/lib/apiResponse";
import { requireAdminKey } from "@/lib/adminAuth";
import { assertNotInMaintenance } from "@/lib/maintenance";
import { requireActiveCity } from "@/lib/city";
import { RiderPayout } from "@/models/RiderPayout";
import { City } from "@/models/City";

type ApiError = Error & { status?: number; code?: string };

function toNumber(value: unknown) {
  const num = Number(value || 0);
  return Number.isFinite(num) ? num : 0;
}

type PayoutRow = {
  _id: mongoose.Types.ObjectId;
  driverId?: mongoose.Types.ObjectId | null;
  driverRef?: string | null;
  orderId?: mongoose.Types.ObjectId | null;
  amount?: number;
  deliveryFeeCharged?: number;
  platformMargin?: number;
  status?: "pending" | "paid" | "void";
  createdAt?: Date;
  paidAt?: Date | null;
};

function serializeRow(row: PayoutRow) {
  return {
    payoutId: String(row._id),
    orderId: row.orderId ? String(row.orderId) : "",
    amount: toNumber(row.amount),
    deliveryFeeCharged: toNumber(row.deliveryFeeCharged),
    platformMargin: toNumber(row.platformMargin),
    status: String(row.status || "pending"),
    createdAt: row.createdAt || null,
    paidAt: row.paidAt || null,
  };
}

export async function GET(req: Request) {
  try {
    requireAdminKey(req);
    await assertNotInMaintenance();
    await dbConnect();

    const url = new URL(req.url);
    const cityId = String(url.searchParams.get("cityId") || "").trim();
    const weekKey = String(url.searchParams.get("weekKey") || "").trim();
    const driverId = String(url.searchParams.get("driverId") || "").trim();

    if (!mongoose.Types.ObjectId.isValid(cityId)) {
      return fail("VALIDATION_ERROR", "Valid cityId is required.", 400);
    }
    if (!weekKey) {
      return fail("VALIDATION_ERROR", "weekKey is required.", 400);
    }
    if (!mongoose.Types.ObjectId.isValid(driverId)) {
      return fail("VALIDATION_ERROR", "Valid driverId is required.", 400);
    }

    const cityObjectId = new mongoose.Types.ObjectId(cityId);
    const driverObjectId = new mongoose.Types.ObjectId(driverId);

    const city = await City.findById(cityObjectId)
      .select("_id code slug name country isActive")
      .lean<{
        _id: mongoose.Types.ObjectId;
        code?: string;
        slug?: string;
        name?: string;
        country?: string;
        isActive?: boolean;
      } | null>();
    if (!city) {
      return fail("NOT_FOUND", "City not found.", 404);
    }
    requireActiveCity({
      isActive: Boolean(city.isActive),
      code: String(city.code || ""),
      name: String(city.name || ""),
      country: String(city.country || ""),
    });

    const baseQuery = {
      cityId: cityObjectId,
      weekKey,
      driverId: driverObjectId,
    };

    const [pendingRows, paidRows, totalRows] = await Promise.all([
      RiderPayout.find({ ...baseQuery, status: "pending" })
        .sort({ createdAt: 1, _id: 1 })
        .select("_id orderId driverId driverRef amount deliveryFeeCharged platformMargin status createdAt paidAt")
        .lean<PayoutRow[]>(),
      RiderPayout.find({ ...baseQuery, status: "paid" })
        .sort({ paidAt: -1, _id: -1 })
        .select("_id orderId driverId driverRef amount deliveryFeeCharged platformMargin status createdAt paidAt")
        .lean<PayoutRow[]>(),
      RiderPayout.find(baseQuery)
        .select("_id orderId driverId driverRef amount deliveryFeeCharged platformMargin status createdAt paidAt")
        .lean<PayoutRow[]>(),
    ]);

    let pendingCount = 0;
    let pendingAmount = 0;
    let paidCount = 0;
    let paidAmount = 0;
    let cashCollected = 0;
    let platformMargin = 0;
    let cashDueToRider = 0;

    for (const row of totalRows) {
      const amount = toNumber(row.amount);
      const deliveryFeeCharged = toNumber(row.deliveryFeeCharged);
      const margin = toNumber(row.platformMargin);
      const status = String(row.status || "");

      if (status === "pending") {
        pendingCount += 1;
        pendingAmount += amount;
      }
      if (status === "paid") {
        paidCount += 1;
        paidAmount += amount;
      }
      if (status !== "void") {
        cashCollected += deliveryFeeCharged;
        platformMargin += margin;
        cashDueToRider += amount;
      }
    }

    const driverRef =
      String(pendingRows[0]?.driverRef || "") ||
      String(paidRows[0]?.driverRef || "") ||
      String(totalRows[0]?.driverRef || "");

    return ok({
      driver: {
        driverId,
        driverRef,
      },
      weekKey,
      cityId,
      totals: {
        pendingCount,
        pendingAmount,
        paidCount,
        paidAmount,
        cashCollected,
        platformMargin,
        cashDueToRider,
        netSettlement: cashDueToRider - platformMargin,
      },
      pending: pendingRows.map(serializeRow),
      paid: paidRows.map(serializeRow),
    });
  } catch (error: unknown) {
    const err = error as ApiError;
    return fail(
      err.code || "SERVER_ERROR",
      err.message || "Could not load driver payouts.",
      err.status || 500
    );
  }
}

