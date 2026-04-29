import mongoose from "mongoose";
import { dbConnect } from "@/lib/mongodb";
import { ok, fail, readJson } from "@/lib/apiResponse";
import { requireAdminKey } from "@/lib/adminAuth";
import { assertNotInMaintenance } from "@/lib/maintenance";
import { normalizeWeekKey, isValidWeekKey } from "@/lib/riderPayouts";
import { RiderPayout } from "@/models/RiderPayout";
import { RiderPayoutBatch } from "@/models/RiderPayoutBatch";

type ApiError = Error & { status?: number; code?: string };

type Body = {
  cityId?: string;
  weekKey?: string;
  limit?: number;
};

export async function POST(req: Request) {
  try {
    requireAdminKey(req);
    await assertNotInMaintenance();

    const body = await readJson<Body>(req);
    const cityId = String(body.cityId || "").trim();
    if (!mongoose.Types.ObjectId.isValid(cityId)) {
      return fail("VALIDATION_ERROR", "Valid cityId is required.", 400);
    }

    const weekKey = normalizeWeekKey(body.weekKey);
    if (!isValidWeekKey(weekKey)) {
      return fail("VALIDATION_ERROR", "Invalid weekKey.", 400);
    }

    const limitRaw = Number(body.limit || 2000);
    const limit = Math.max(1, Math.min(10000, Math.floor(Number.isFinite(limitRaw) ? limitRaw : 2000)));

    await dbConnect();
    const cityObjectId = new mongoose.Types.ObjectId(cityId);

    const pendingPayouts = await RiderPayout.find({
      cityId: cityObjectId,
      weekKey,
      status: "pending",
    })
      .sort({ createdAt: 1, _id: 1 })
      .limit(limit)
      .select("_id amount deliveryFeeCharged platformMargin")
      .lean<
        Array<{
          _id: mongoose.Types.ObjectId;
          amount?: number;
          deliveryFeeCharged?: number;
          platformMargin?: number;
        }>
      >();

    let payoutsCount = 0;
    let totalAmount = 0;
    let totalDeliveryFeeCharged = 0;
    let totalPlatformMargin = 0;

    for (const payout of pendingPayouts) {
      payoutsCount += 1;
      totalAmount += Number(payout.amount || 0);
      totalDeliveryFeeCharged += Number(payout.deliveryFeeCharged || 0);
      totalPlatformMargin += Number(payout.platformMargin || 0);
    }

    const payoutIds = pendingPayouts.map((row) => row._id);

    const batch = await RiderPayoutBatch.findOneAndUpdate(
      { cityId: cityObjectId, weekKey, status: "open" },
      {
        $setOnInsert: {
          createdByAdminId: "admin_key",
        },
        $set: {
          payoutIds,
          payoutsCount,
          totalAmount,
          totalDeliveryFeeCharged,
          totalPlatformMargin,
        },
      },
      { upsert: true, returnDocument: "after" }
    ).lean<{
      _id: mongoose.Types.ObjectId;
      cityId: mongoose.Types.ObjectId;
      weekKey: string;
      status: "open" | "paid" | "void";
      payoutIds?: mongoose.Types.ObjectId[];
      payoutsCount?: number;
      totalAmount?: number;
      totalDeliveryFeeCharged?: number;
      totalPlatformMargin?: number;
      createdByAdminId?: string | null;
      paidByAdminId?: string | null;
      paidAt?: Date | null;
      note?: string | null;
      createdAt?: Date;
      updatedAt?: Date;
    } | null>();

    if (!batch) {
      return fail("SERVER_ERROR", "Could not upsert rider payout batch.", 500);
    }

    return ok({
      batch: {
        id: String(batch._id),
        cityId: String(batch.cityId),
        weekKey: String(batch.weekKey || ""),
        status: batch.status,
        payoutsCount: Number(batch.payoutsCount || 0),
        totalAmount: Number(batch.totalAmount || 0),
        totalDeliveryFeeCharged: Number(batch.totalDeliveryFeeCharged || 0),
        totalPlatformMargin: Number(batch.totalPlatformMargin || 0),
        createdByAdminId: String(batch.createdByAdminId || "").trim() || null,
        paidByAdminId: String(batch.paidByAdminId || "").trim() || null,
        paidAt: batch.paidAt || null,
        note: String(batch.note || "").trim() || null,
        createdAt: batch.createdAt || null,
        updatedAt: batch.updatedAt || null,
      },
      payoutIdsPreview: payoutIds.slice(0, 50).map((id) => String(id)),
    });
  } catch (error: unknown) {
    const err = error as ApiError;
    return fail(
      err.code || "SERVER_ERROR",
      err.message || "Could not upsert rider payout batch.",
      err.status || 500
    );
  }
}
