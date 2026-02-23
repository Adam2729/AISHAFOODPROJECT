import mongoose from "mongoose";
import { dbConnect } from "@/lib/mongodb";
import { ok, fail } from "@/lib/apiResponse";
import { requireAdminKey } from "@/lib/adminAuth";

type ApiError = Error & { status?: number; code?: string };

type IndexSpec = {
  collection: string;
  key: Record<string, 1 | -1>;
  unique?: boolean;
  label: string;
};

type CheckResult = {
  collection: string;
  label: string;
  key: Record<string, 1 | -1>;
  unique: boolean;
  present: boolean;
};

const REQUIRED_INDEXES: IndexSpec[] = [
  {
    collection: "orders",
    key: { orderNumber: 1 },
    unique: true,
    label: "orders.orderNumber unique",
  },
  {
    collection: "settlements",
    key: { businessId: 1, weekKey: 1 },
    unique: true,
    label: "settlements.businessId_weekKey unique",
  },
  {
    collection: "appsettings",
    key: { key: 1 },
    unique: true,
    label: "appsettings.key unique",
  },
  {
    collection: "settlementaudits",
    key: { businessId: 1, weekKey: 1, createdAt: -1 },
    label: "settlementaudits.business_week_createdAt",
  },
  {
    collection: "settlementaudits",
    key: { action: 1, createdAt: -1 },
    label: "settlementaudits.action_createdAt",
  },
  {
    collection: "businessaudits",
    key: { businessId: 1, createdAt: -1 },
    label: "businessaudits.business_createdAt",
  },
  {
    collection: "businessaudits",
    key: { action: 1, createdAt: -1 },
    label: "businessaudits.action_createdAt",
  },
];

function normalizeIndexKey(key: Record<string, unknown>) {
  return JSON.stringify(key);
}

function hasIndex(
  indexes: Array<{ key: Record<string, unknown>; unique?: boolean }>,
  expectedKey: Record<string, 1 | -1>,
  expectedUnique = false
) {
  const normalizedExpectedKey = normalizeIndexKey(expectedKey);
  return indexes.some((idx) => {
    const sameKey = normalizeIndexKey(idx.key) === normalizedExpectedKey;
    if (!sameKey) return false;
    if (!expectedUnique) return true;
    return Boolean(idx.unique);
  });
}

export async function GET(req: Request) {
  try {
    requireAdminKey(req);
    await dbConnect();

    const db = mongoose.connection.db;
    if (!db) {
      return fail("SERVER_ERROR", "Database connection is unavailable.", 500);
    }

    const checks = await Promise.all(
      REQUIRED_INDEXES.map(async (required): Promise<CheckResult> => {
        const indexes = await db.collection(required.collection).indexes();
        const present = hasIndex(indexes, required.key, Boolean(required.unique));
        return {
          collection: required.collection,
          label: required.label,
          key: required.key,
          unique: Boolean(required.unique),
          present,
        };
      })
    );

    const allPassed = checks.every((c) => c.present);
    return ok({
      allPassed,
      checks,
      checkedAt: new Date().toISOString(),
    });
  } catch (e: unknown) {
    const err = e as ApiError;
    return fail(
      err.code || "SERVER_ERROR",
      err.message || "Could not verify indexes.",
      err.status || 500
    );
  }
}
