import mongoose from "mongoose";
import { dbConnect } from "@/lib/mongodb";
import { ok, fail, readJson } from "@/lib/apiResponse";
import { requireAdminKey } from "@/lib/adminAuth";
import { assertNotInMaintenance } from "@/lib/maintenance";
import { getCityByIdOrDefault, requireActiveCity } from "@/lib/city";
import { ENV_ALLOW_ADMIN_PAY_DISABLED_CITY } from "@/lib/env";
import { markRiderPayoutsPaid } from "@/lib/riderPayouts";
import { RiderPayout } from "@/models/RiderPayout";
import { RiderPayoutBatch } from "@/models/RiderPayoutBatch";

type ApiError = Error & { status?: number; code?: string };

type Body = {
  note?: string;
};

function normalizeText(value: unknown, max: number) {
  return String(value || "").trim().slice(0, max);
}

function formatBatch(batch: {
  _id: mongoose.Types.ObjectId;
  cityId: mongoose.Types.ObjectId;
  weekKey: string;
  status: "open" | "paid" | "void";
  payoutsCount?: number;
  totalAmount?: number;
  totalDeliveryFeeCharged?: number;
  totalPlatformMargin?: number;
  paidAt?: Date | null;
  paidByAdminId?: string | null;
  note?: string | null;
  updatedAt?: Date;
}) {
  return {
    id: String(batch._id),
    cityId: String(batch.cityId),
    weekKey: String(batch.weekKey || ""),
    status: batch.status,
    payoutsCount: Number(batch.payoutsCount || 0),
    totalAmount: Number(batch.totalAmount || 0),
    totalDeliveryFeeCharged: Number(batch.totalDeliveryFeeCharged || 0),
    totalPlatformMargin: Number(batch.totalPlatformMargin || 0),
    paidAt: batch.paidAt || null,
    paidByAdminId: String(batch.paidByAdminId || "").trim() || null,
    note: String(batch.note || "").trim() || null,
    updatedAt: batch.updatedAt || null,
  };
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ batchId: string }> }
) {
  try {
    requireAdminKey(req);
    await assertNotInMaintenance();

    const { batchId } = await params;
    if (!mongoose.Types.ObjectId.isValid(batchId)) {
      return fail("VALIDATION_ERROR", "Invalid batchId.", 400);
    }

    const body = await readJson<Body>(req);
    const note = normalizeText(body.note, 280) || null;
    const paidAt = new Date();
    const paidByAdminId = "admin_key";

    await dbConnect();
    const batch = await RiderPayoutBatch.findById(new mongoose.Types.ObjectId(batchId)).lean<{
      _id: mongoose.Types.ObjectId;
      cityId: mongoose.Types.ObjectId;
      weekKey: string;
      status: "open" | "paid" | "void";
      payoutIds?: mongoose.Types.ObjectId[];
      payoutsCount?: number;
      totalAmount?: number;
      totalDeliveryFeeCharged?: number;
      totalPlatformMargin?: number;
      paidAt?: Date | null;
      paidByAdminId?: string | null;
      note?: string | null;
      updatedAt?: Date;
    } | null>();

    if (!batch) {
      return fail("NOT_FOUND", "Batch not found.", 404);
    }

    const city = await getCityByIdOrDefault(batch.cityId);
    try {
      requireActiveCity(city);
    } catch (error) {
      if (!ENV_ALLOW_ADMIN_PAY_DISABLED_CITY) {
        const err = error as ApiError;
        return fail(err.code || "CITY_DISABLED", err.message || "City is disabled.", err.status || 403);
      }
    }

    if (batch.status === "paid") {
      return ok({
        paid: true,
        updatedCount: 0,
        batch: formatBatch(batch),
      });
    }

    if (batch.status !== "open") {
      return fail("BATCH_NOT_OPEN", "Only open batches can be paid.", 409);
    }

    const payoutIds = Array.isArray(batch.payoutIds) ? batch.payoutIds.map((id) => String(id)) : [];

    const result = await markRiderPayoutsPaid({
      payoutIds,
      paidAt,
      paidByAdminId,
      note,
      scope: { cityId: batch.cityId },
    });

    const paidRows = result.updatedRows;
    let payoutsCount = 0;
    let totalAmount = 0;
    let totalDeliveryFeeCharged = 0;
    let totalPlatformMargin = 0;
    for (const row of paidRows) {
      payoutsCount += 1;
      totalAmount += Number(row.amount || 0);
      totalDeliveryFeeCharged += Number(row.deliveryFeeCharged || 0);
      totalPlatformMargin += Number(row.platformMargin || 0);
    }

    const existingPaidBatch = await RiderPayoutBatch.findOne({
      cityId: batch.cityId,
      weekKey: batch.weekKey,
      status: "paid",
      _id: { $ne: batch._id },
    }).lean<{
      _id: mongoose.Types.ObjectId;
      cityId: mongoose.Types.ObjectId;
      weekKey: string;
      status: "open" | "paid" | "void";
      payoutsCount?: number;
      totalAmount?: number;
      totalDeliveryFeeCharged?: number;
      totalPlatformMargin?: number;
      paidAt?: Date | null;
      paidByAdminId?: string | null;
      note?: string | null;
      updatedAt?: Date;
    } | null>();

    if (existingPaidBatch) {
      const allPaidRows = await RiderPayout.find({
        cityId: batch.cityId,
        weekKey: batch.weekKey,
        status: "paid",
      })
        .select("amount deliveryFeeCharged platformMargin")
        .lean<Array<{ amount?: number; deliveryFeeCharged?: number; platformMargin?: number }>>();

      let mergedCount = 0;
      let mergedAmount = 0;
      let mergedDeliveryFee = 0;
      let mergedPlatformMargin = 0;
      for (const row of allPaidRows) {
        mergedCount += 1;
        mergedAmount += Number(row.amount || 0);
        mergedDeliveryFee += Number(row.deliveryFeeCharged || 0);
        mergedPlatformMargin += Number(row.platformMargin || 0);
      }

      const mergedBatch = await RiderPayoutBatch.findOneAndUpdate(
        { _id: existingPaidBatch._id },
        {
          $set: {
            payoutsCount: mergedCount,
            totalAmount: mergedAmount,
            totalDeliveryFeeCharged: mergedDeliveryFee,
            totalPlatformMargin: mergedPlatformMargin,
            paidAt: existingPaidBatch.paidAt || paidAt,
            paidByAdminId: String(existingPaidBatch.paidByAdminId || "").trim() || paidByAdminId,
          },
        },
        { returnDocument: "after" }
      ).lean<{
        _id: mongoose.Types.ObjectId;
        cityId: mongoose.Types.ObjectId;
        weekKey: string;
        status: "open" | "paid" | "void";
        payoutsCount?: number;
        totalAmount?: number;
        totalDeliveryFeeCharged?: number;
        totalPlatformMargin?: number;
        paidAt?: Date | null;
        paidByAdminId?: string | null;
        note?: string | null;
        updatedAt?: Date;
      } | null>();

      await RiderPayoutBatch.deleteOne({ _id: batch._id, status: "open" });

      if (!mergedBatch) {
        return fail("SERVER_ERROR", "Could not update existing paid batch.", 500);
      }

      return ok({
        paid: true,
        mergedIntoBatchId: String(existingPaidBatch._id),
        updatedCount: Number(result.updatedCount || 0),
        batch: formatBatch(mergedBatch),
      });
    }

    const updatedBatch = await RiderPayoutBatch.findOneAndUpdate(
      { _id: batch._id },
      {
        $set: {
          status: "paid",
          paidAt,
          paidByAdminId,
          ...(note ? { note } : {}),
          payoutsCount,
          totalAmount,
          totalDeliveryFeeCharged,
          totalPlatformMargin,
        },
      },
      { returnDocument: "after" }
    ).lean<{
      _id: mongoose.Types.ObjectId;
      cityId: mongoose.Types.ObjectId;
      weekKey: string;
      status: "open" | "paid" | "void";
      payoutsCount?: number;
      totalAmount?: number;
      totalDeliveryFeeCharged?: number;
      totalPlatformMargin?: number;
      paidAt?: Date | null;
      paidByAdminId?: string | null;
      note?: string | null;
      updatedAt?: Date;
    } | null>();

    if (!updatedBatch) {
      return fail("SERVER_ERROR", "Could not update batch.", 500);
    }

    return ok({
      paid: true,
      updatedCount: Number(result.updatedCount || 0),
      batch: formatBatch(updatedBatch),
    });
  } catch (error: unknown) {
    const err = error as ApiError;
    return fail(
      err.code || "SERVER_ERROR",
      err.message || "Could not pay rider payout batch.",
      err.status || 500
    );
  }
}
