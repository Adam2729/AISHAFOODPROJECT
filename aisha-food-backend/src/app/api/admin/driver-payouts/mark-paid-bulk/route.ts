import mongoose from "mongoose";
import { dbConnect } from "@/lib/mongodb";
import { ok, fail, readJson } from "@/lib/apiResponse";
import { requireAdminKey } from "@/lib/adminAuth";
import { assertNotInMaintenance } from "@/lib/maintenance";
import { requireActiveCity } from "@/lib/city";
import { parsePaidAt } from "@/lib/riderPayouts";
import { RiderPayout } from "@/models/RiderPayout";
import { City } from "@/models/City";

type ApiError = Error & { status?: number; code?: string };

type Body = {
  cityId?: string;
  weekKey?: string;
  driverId?: string;
  payoutIds?: string[];
  note?: string;
  paidAt?: string;
  paidByAdminId?: string;
};

type Row = {
  _id: mongoose.Types.ObjectId;
  cityId?: mongoose.Types.ObjectId;
  weekKey?: string;
  driverId?: mongoose.Types.ObjectId | null;
  status?: "pending" | "paid" | "void";
};

function normalizeText(value: unknown, max: number) {
  return String(value || "").trim().slice(0, max);
}

export async function POST(req: Request) {
  try {
    requireAdminKey(req);
    await assertNotInMaintenance();
    await dbConnect();

    const body = await readJson<Body>(req);
    const cityId = String(body.cityId || "").trim();
    const weekKey = String(body.weekKey || "").trim();
    const driverId = String(body.driverId || "").trim();
    const inputPayoutIds = Array.isArray(body.payoutIds)
      ? body.payoutIds.map((id) => String(id || "").trim()).filter(Boolean)
      : [];

    if (!mongoose.Types.ObjectId.isValid(cityId)) {
      return fail("VALIDATION_ERROR", "Valid cityId is required.", 400);
    }
    if (!weekKey) {
      return fail("VALIDATION_ERROR", "weekKey is required.", 400);
    }
    if (!mongoose.Types.ObjectId.isValid(driverId)) {
      return fail("VALIDATION_ERROR", "Valid driverId is required.", 400);
    }
    if (!inputPayoutIds.length) {
      return fail("VALIDATION_ERROR", "payoutIds is required.", 400);
    }
    if (inputPayoutIds.length > 500) {
      return fail("VALIDATION_ERROR", "payoutIds max is 500.", 400);
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

    const uniqueIds = Array.from(new Set(inputPayoutIds));
    const skipped: Array<{ payoutId: string; reason: string }> = [];
    const validIds: mongoose.Types.ObjectId[] = [];
    for (const payoutId of uniqueIds) {
      if (!mongoose.Types.ObjectId.isValid(payoutId)) {
        skipped.push({ payoutId, reason: "INVALID_ID" });
        continue;
      }
      validIds.push(new mongoose.Types.ObjectId(payoutId));
    }

    const rows = validIds.length
      ? await RiderPayout.find({ _id: { $in: validIds } })
          .select("_id cityId weekKey driverId status")
          .lean<Row[]>()
      : [];
    const rowMap = new Map(rows.map((row) => [String(row._id), row]));

    const toUpdate: mongoose.Types.ObjectId[] = [];
    for (const payoutId of uniqueIds) {
      if (!mongoose.Types.ObjectId.isValid(payoutId)) continue;
      const row = rowMap.get(payoutId);
      if (!row) {
        skipped.push({ payoutId, reason: "NOT_FOUND" });
        continue;
      }
      const scopeMatch =
        String(row.cityId || "") === cityId &&
        String(row.weekKey || "") === weekKey &&
        String(row.driverId || "") === driverId;
      if (!scopeMatch) {
        skipped.push({ payoutId, reason: "OUT_OF_SCOPE" });
        continue;
      }
      if (String(row.status || "") !== "pending") {
        skipped.push({ payoutId, reason: "NOT_PENDING" });
        continue;
      }
      toUpdate.push(new mongoose.Types.ObjectId(payoutId));
    }

    const parsedPaidAt = parsePaidAt(body.paidAt);
    if (body.paidAt != null && !parsedPaidAt) {
      return fail("VALIDATION_ERROR", "Invalid paidAt.", 400);
    }

    const now = parsedPaidAt || new Date();
    const note = normalizeText(body.note, 280) || null;
    const paidByAdminId = normalizeText(body.paidByAdminId, 80) || "admin_key";

    let updatedCount = 0;
    if (toUpdate.length) {
      const updateResult = await RiderPayout.updateMany(
        {
          _id: { $in: toUpdate },
          cityId: cityObjectId,
          weekKey,
          driverId: driverObjectId,
          status: "pending",
        },
        {
          $set: {
            status: "paid",
            paidAt: now,
            paidByAdminId,
            note,
          },
        }
      );
      updatedCount = Number(updateResult.modifiedCount || 0);
    }

    return ok({
      requestedCount: uniqueIds.length,
      updatedCount,
      payoutIdsUpdated: toUpdate.map((id) => String(id)),
      skipped,
    });
  } catch (error: unknown) {
    const err = error as ApiError;
    return fail(
      err.code || "SERVER_ERROR",
      err.message || "Could not mark payouts paid in bulk.",
      err.status || 500
    );
  }
}

