import mongoose from "mongoose";
import { getWeekKey } from "@/lib/geo";
import { RiderPayout } from "@/models/RiderPayout";

export type RiderPayoutStatus = "pending" | "paid" | "void";
export type RiderPayoutStatusFilter = RiderPayoutStatus | "all";

export type MarkPaidSkipReason =
  | "INVALID_ID"
  | "NOT_FOUND"
  | "SCOPE_MISMATCH"
  | "NOT_PENDING";

export type MarkPaidSkipItem = {
  payoutId: string;
  reason: MarkPaidSkipReason;
};

export type MarkPaidRow = {
  _id: mongoose.Types.ObjectId;
  cityId: mongoose.Types.ObjectId;
  driverId?: mongoose.Types.ObjectId | null;
  status: RiderPayoutStatus;
  amount: number;
  deliveryFeeCharged: number;
  platformMargin: number;
  paidAt?: Date | null;
  paidByAdminId?: string | null;
};

export type MarkPaidResult = {
  requested: number;
  validRequested: number;
  updatedCount: number;
  updatedIds: string[];
  skipped: MarkPaidSkipItem[];
  updatedRows: MarkPaidRow[];
};

const WEEK_KEY_REGEX = /^\d{4}-W(0[1-9]|[1-4][0-9]|5[0-3])$/;

function normalizeText(value: unknown, max = 280) {
  return String(value || "").trim().slice(0, max);
}

export function isValidWeekKey(value: unknown) {
  return WEEK_KEY_REGEX.test(String(value || "").trim());
}

export function normalizeWeekKey(value: unknown, fallbackDate = new Date()) {
  const weekKey = String(value || "").trim();
  if (isValidWeekKey(weekKey)) return weekKey;
  return getWeekKey(fallbackDate);
}

export function parsePaidAt(value: unknown): Date | null {
  if (value == null || String(value).trim().length === 0) return null;
  const parsed = new Date(String(value));
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

export function normalizeRiderPayoutStatus(value: unknown, fallback: RiderPayoutStatus = "pending") {
  const status = String(value || "").trim().toLowerCase();
  if (status === "pending" || status === "paid" || status === "void") return status;
  return fallback;
}

export function normalizeRiderPayoutStatusFilter(
  value: unknown,
  fallback: RiderPayoutStatusFilter = "pending"
): RiderPayoutStatusFilter {
  const status = String(value || "").trim().toLowerCase();
  if (status === "pending" || status === "paid" || status === "void" || status === "all") {
    return status;
  }
  return fallback;
}

function objectIdOrNull(value: string) {
  if (!mongoose.Types.ObjectId.isValid(value)) return null;
  return new mongoose.Types.ObjectId(value);
}

function objectIdEquals(a: unknown, b: unknown) {
  return String(a || "") === String(b || "");
}

export function sumPayoutRows(rows: Array<Pick<MarkPaidRow, "amount" | "deliveryFeeCharged" | "platformMargin">>) {
  let payoutsCount = 0;
  let totalAmount = 0;
  let totalDeliveryFeeCharged = 0;
  let totalPlatformMargin = 0;

  for (const row of rows) {
    payoutsCount += 1;
    totalAmount += Number(row.amount || 0);
    totalDeliveryFeeCharged += Number(row.deliveryFeeCharged || 0);
    totalPlatformMargin += Number(row.platformMargin || 0);
  }

  return {
    payoutsCount,
    totalAmount,
    totalDeliveryFeeCharged,
    totalPlatformMargin,
    totalPaidToRiders: totalAmount,
    grossDeliveryFees: totalDeliveryFeeCharged,
    platformMarginTotal: totalPlatformMargin,
  };
}

export async function markRiderPayoutsPaid(input: {
  payoutIds: string[];
  note?: unknown;
  paidAt?: Date;
  paidByAdminId?: unknown;
  scope?: {
    cityId?: mongoose.Types.ObjectId | string | null;
    driverId?: mongoose.Types.ObjectId | string | null;
  };
}): Promise<MarkPaidResult> {
  const rawIds = Array.isArray(input.payoutIds) ? input.payoutIds : [];
  const uniqueIds = Array.from(
    new Set(
      rawIds
        .map((value) => String(value || "").trim())
        .filter(Boolean)
    )
  );

  const skipped: MarkPaidSkipItem[] = [];
  const validIds: string[] = [];
  for (const payoutId of uniqueIds) {
    if (!mongoose.Types.ObjectId.isValid(payoutId)) {
      skipped.push({ payoutId, reason: "INVALID_ID" });
      continue;
    }
    validIds.push(payoutId);
  }

  const objectIds = validIds.map((id) => new mongoose.Types.ObjectId(id));
  const rows = objectIds.length
    ? await RiderPayout.find({ _id: { $in: objectIds } })
        .select("_id cityId driverId status amount deliveryFeeCharged platformMargin paidAt paidByAdminId")
        .lean<MarkPaidRow[]>()
    : [];

  const rowMap = new Map(rows.map((row) => [String(row._id), row]));
  const toUpdate: mongoose.Types.ObjectId[] = [];
  const scopeCityId = input.scope?.cityId ? objectIdOrNull(String(input.scope.cityId)) : null;
  const scopeDriverId = input.scope?.driverId ? objectIdOrNull(String(input.scope.driverId)) : null;

  for (const payoutId of validIds) {
    const row = rowMap.get(payoutId);
    if (!row) {
      skipped.push({ payoutId, reason: "NOT_FOUND" });
      continue;
    }
    if (scopeCityId && !objectIdEquals(row.cityId, scopeCityId)) {
      skipped.push({ payoutId, reason: "SCOPE_MISMATCH" });
      continue;
    }
    if (scopeDriverId && !objectIdEquals(row.driverId, scopeDriverId)) {
      skipped.push({ payoutId, reason: "SCOPE_MISMATCH" });
      continue;
    }
    if (String(row.status || "") !== "pending") {
      skipped.push({ payoutId, reason: "NOT_PENDING" });
      continue;
    }
    toUpdate.push(new mongoose.Types.ObjectId(payoutId));
  }

  const now = input.paidAt instanceof Date ? input.paidAt : new Date();
  const paidByAdminId = normalizeText(input.paidByAdminId, 80) || "admin_key";
  const note = normalizeText(input.note, 280) || null;

  let updatedCount = 0;
  if (toUpdate.length) {
    const updateQuery: Record<string, unknown> = {
      _id: { $in: toUpdate },
      status: "pending",
    };
    if (scopeCityId) updateQuery.cityId = scopeCityId;
    if (scopeDriverId) updateQuery.driverId = scopeDriverId;

    const updated = await RiderPayout.updateMany(updateQuery, {
      $set: {
        status: "paid",
        paidAt: now,
        paidByAdminId,
        note,
      },
    });
    updatedCount = Number(updated.modifiedCount || 0);
  }

  const updatedRows = toUpdate.length
    ? await RiderPayout.find({
        _id: { $in: toUpdate },
        status: "paid",
      })
        .select("_id cityId driverId status amount deliveryFeeCharged platformMargin paidAt paidByAdminId")
        .lean<MarkPaidRow[]>()
    : [];

  return {
    requested: uniqueIds.length,
    validRequested: validIds.length,
    updatedCount,
    updatedIds: updatedRows.map((row) => String(row._id)),
    skipped,
    updatedRows,
  };
}
