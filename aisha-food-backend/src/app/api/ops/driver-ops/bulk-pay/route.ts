import mongoose from "mongoose";
import { dbConnect } from "@/lib/mongodb";
import { ok, fail, readJson } from "@/lib/apiResponse";
import { requireAdminKey } from "@/lib/adminAuth";
import { assertNotInMaintenance } from "@/lib/maintenance";
import { cityCode, requireActiveCity, resolveCityFromRequest } from "@/lib/city";
import { isValidWeekKey } from "@/lib/riderPayouts";
import { RiderPayout } from "@/models/RiderPayout";

type ApiError = Error & { status?: number; code?: string };

type Body = {
  weekKey?: string;
  payoutIds?: string[];
  note?: string;
};

type PayoutRow = {
  _id: mongoose.Types.ObjectId;
  cityId?: mongoose.Types.ObjectId;
  weekKey?: string;
  status?: "pending" | "paid" | "void";
};

function normalizeText(value: unknown, max = 280) {
  return String(value || "").trim().slice(0, max);
}

export async function POST(req: Request) {
  try {
    requireAdminKey(req);
    await assertNotInMaintenance();
    await dbConnect();

    const selectedCity = await resolveCityFromRequest(req);
    requireActiveCity({
      isActive: Boolean(selectedCity.isActive),
      code: String(selectedCity.code || ""),
      name: String(selectedCity.name || ""),
      country: String(selectedCity.country || ""),
    });

    const body = await readJson<Body>(req);
    const weekKey = String(body.weekKey || "").trim();
    const payoutIds = Array.isArray(body.payoutIds)
      ? body.payoutIds.map((id) => String(id || "").trim()).filter(Boolean)
      : [];
    const note = normalizeText(body.note, 280) || null;

    if (!isValidWeekKey(weekKey)) {
      return fail("VALIDATION_ERROR", "Invalid weekKey format. Use YYYY-Www.", 400);
    }
    if (!payoutIds.length) {
      return fail("VALIDATION_ERROR", "payoutIds is required.", 400);
    }
    if (payoutIds.length > 500) {
      return fail("VALIDATION_ERROR", "payoutIds max is 500.", 400);
    }

    const uniqueIds = Array.from(new Set(payoutIds));
    const cityObjectId = new mongoose.Types.ObjectId(String(selectedCity._id));
    const skipped: Array<{ payoutId: string; reason: string }> = [];
    const validObjectIds: mongoose.Types.ObjectId[] = [];

    for (const payoutId of uniqueIds) {
      if (!mongoose.Types.ObjectId.isValid(payoutId)) {
        skipped.push({ payoutId, reason: "INVALID_ID" });
        continue;
      }
      validObjectIds.push(new mongoose.Types.ObjectId(payoutId));
    }

    const existingRows = validObjectIds.length
      ? await RiderPayout.find({ _id: { $in: validObjectIds } })
          .select("_id cityId weekKey status")
          .lean<PayoutRow[]>()
      : [];
    const rowMap = new Map(existingRows.map((row) => [String(row._id), row]));

    const toUpdate: mongoose.Types.ObjectId[] = [];
    for (const payoutId of uniqueIds) {
      if (!mongoose.Types.ObjectId.isValid(payoutId)) continue;
      const row = rowMap.get(payoutId);
      if (!row) {
        skipped.push({ payoutId, reason: "NOT_FOUND" });
        continue;
      }
      if (String(row.cityId || "") !== String(cityObjectId)) {
        skipped.push({ payoutId, reason: "OUT_OF_SCOPE_CITY" });
        continue;
      }
      if (String(row.weekKey || "") !== weekKey) {
        skipped.push({ payoutId, reason: "OUT_OF_SCOPE_WEEK" });
        continue;
      }
      if (String(row.status || "") !== "pending") {
        skipped.push({ payoutId, reason: "NOT_PENDING" });
        continue;
      }
      toUpdate.push(new mongoose.Types.ObjectId(payoutId));
    }

    let updatedCount = 0;
    if (toUpdate.length) {
      const updateResult = await RiderPayout.updateMany(
        {
          _id: { $in: toUpdate },
          cityId: cityObjectId,
          weekKey,
          status: "pending",
        },
        {
          $set: {
            status: "paid",
            paidAt: new Date(),
            paidByAdminId: "admin_key",
            note,
          },
        }
      );
      updatedCount = Number(updateResult.modifiedCount || 0);
    }

    return ok({
      cityId: String(selectedCity._id),
      cityCode: cityCode(selectedCity),
      weekKey,
      requestedCount: uniqueIds.length,
      updatedCount,
      skippedCount: skipped.length,
      skipped,
    });
  } catch (error: unknown) {
    const err = error as ApiError;
    return fail(
      err.code || "SERVER_ERROR",
      err.message || "Could not mark payouts paid.",
      err.status || 500
    );
  }
}
