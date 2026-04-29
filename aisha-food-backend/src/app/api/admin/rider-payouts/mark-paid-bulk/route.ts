import mongoose from "mongoose";
import { dbConnect } from "@/lib/mongodb";
import { ok, fail, readJson } from "@/lib/apiResponse";
import { requireAdminKey } from "@/lib/adminAuth";
import { assertNotInMaintenance } from "@/lib/maintenance";
import { cityCode, requireActiveCity, resolveCityFromRequest } from "@/lib/city";
import { isValidWeekKey, parsePaidAt } from "@/lib/riderPayouts";
import { RiderPayout } from "@/models/RiderPayout";
import { OpsEvent } from "@/models/OpsEvent";

type ApiError = Error & { status?: number; code?: string };

type Body = {
  cityId?: string;
  weekKey?: string;
  payoutIds?: string[];
  note?: string;
  paidAt?: string;
};

export async function POST(req: Request) {
  try {
    requireAdminKey(req);
    await assertNotInMaintenance();

    const body = await readJson<Body>(req);
    const cityId = String(body.cityId || "").trim();
    const weekKey = String(body.weekKey || "").trim();
    const payoutIds = Array.isArray(body.payoutIds)
      ? body.payoutIds.map((value) => String(value || "").trim()).filter(Boolean)
      : [];

    if (!mongoose.Types.ObjectId.isValid(cityId)) {
      return fail("VALIDATION_ERROR", "Valid cityId is required.", 400);
    }
    if (!isValidWeekKey(weekKey)) {
      return fail("VALIDATION_ERROR", "Invalid weekKey format. Use YYYY-Www.", 400);
    }
    if (!payoutIds.length) {
      return fail("VALIDATION_ERROR", "payoutIds is required.", 400);
    }
    if (payoutIds.length > 500) {
      return fail("VALIDATION_ERROR", "payoutIds max is 500.", 400);
    }

    const parsedPaidAt = parsePaidAt(body.paidAt);
    if (body.paidAt != null && !parsedPaidAt) {
      return fail("VALIDATION_ERROR", "Invalid paidAt.", 400);
    }

    await dbConnect();
    const selectedCity = await resolveCityFromRequest(req);
    requireActiveCity({
      isActive: Boolean(selectedCity.isActive),
      code: String(selectedCity.code || ""),
      name: String(selectedCity.name || ""),
      country: String(selectedCity.country || ""),
    });
    if (String(selectedCity._id) !== cityId) {
      return fail("CITY_MISMATCH", "cityId does not match selected city.", 403);
    }

    const uniqueIds = Array.from(new Set(payoutIds)).filter((id) =>
      mongoose.Types.ObjectId.isValid(id)
    );
    const objectIds = uniqueIds.map((id) => new mongoose.Types.ObjectId(id));
    const rows = uniqueIds.length
      ? await RiderPayout.find({ _id: { $in: objectIds } })
          .select("_id cityId weekKey status")
          .lean<
            Array<{
              _id: mongoose.Types.ObjectId;
              cityId?: mongoose.Types.ObjectId;
              weekKey?: string;
              status?: string;
            }>
          >()
      : [];

    const pendingIds: mongoose.Types.ObjectId[] = [];
    let skippedWrongScope = 0;
    let skippedPaidOrVoid = 0;

    for (const row of rows) {
      if (String(row.cityId || "") !== cityId || String(row.weekKey || "") !== weekKey) {
        skippedWrongScope += 1;
        continue;
      }
      if (String(row.status || "") !== "pending") {
        skippedPaidOrVoid += 1;
        continue;
      }
      pendingIds.push(row._id);
    }

    const paidAt = parsedPaidAt || new Date();
    const note = String(body.note || "").trim().slice(0, 280) || null;
    let updatedCount = 0;
    if (pendingIds.length) {
      const updateResult = await RiderPayout.updateMany(
        {
          _id: { $in: pendingIds },
          cityId: new mongoose.Types.ObjectId(cityId),
          weekKey,
          status: "pending",
        },
        {
          $set: {
            status: "paid",
            paidAt,
            paidByAdminId: "admin_key",
            note,
          },
        }
      );
      updatedCount = Number(updateResult.modifiedCount || 0);
    }

    try {
      await OpsEvent.create({
        type: "RIDER_PAYOUTS_BULK_PAID",
        severity: "low",
        weekKey,
        cityId: new mongoose.Types.ObjectId(cityId),
        businessId: null,
        businessName: "ops",
        meta: {
          requestedCount: payoutIds.length,
          updatedCount,
          payoutIdsSample: payoutIds.slice(0, 10),
          note,
        },
      });
    } catch {
      // audit must not block
    }

    return ok({
      requestedCount: payoutIds.length,
      matchedPendingCount: pendingIds.length,
      updatedCount,
      skipped: {
        notFoundOrWrongScope: payoutIds.length - rows.length + skippedWrongScope,
        alreadyPaidOrVoid: skippedPaidOrVoid,
      },
      paidAtIso: paidAt.toISOString(),
      cityCode: cityCode(selectedCity),
    });
  } catch (error: unknown) {
    const err = error as ApiError;
    return fail(
      err.code || "SERVER_ERROR",
      err.message || "Could not mark rider payouts as paid.",
      err.status || 500
    );
  }
}
