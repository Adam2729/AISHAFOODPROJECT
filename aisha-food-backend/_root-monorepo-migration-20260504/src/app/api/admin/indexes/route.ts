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
    collection: "orders",
    key: { businessId: 1, "settlement.weekKey": 1, status: 1, "settlement.counted": 1, createdAt: -1 },
    label: "orders.business_week_status_counted_createdAt",
  },
  {
    collection: "orders",
    key: { phone: 1, createdAt: 1 },
    label: "orders.phone_createdAt",
  },
  {
    collection: "orders",
    key: { "dispatch.assignedDriverId": 1, createdAt: -1 },
    label: "orders.dispatch.assignedDriverId_createdAt",
  },
  {
    collection: "orders",
    key: { status: 1, "dispatch.assignedDriverId": 1, createdAt: -1 },
    label: "orders.status_dispatch.assignedDriverId_createdAt",
  },
  {
    collection: "orders",
    key: { "deliveryProof.verifiedAt": -1, createdAt: -1 },
    label: "orders.deliveryProof.verifiedAt_createdAt",
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
  {
    collection: "reviews",
    key: { orderId: 1 },
    unique: true,
    label: "reviews.orderId unique",
  },
  {
    collection: "reviews",
    key: { businessId: 1, createdAt: -1 },
    label: "reviews.business_createdAt",
  },
  {
    collection: "reviews",
    key: { businessId: 1, rating: 1, createdAt: -1 },
    label: "reviews.business_rating_createdAt",
  },
  {
    collection: "cashcollections",
    key: { businessId: 1, weekKey: 1 },
    unique: true,
    label: "cashcollections.business_week unique",
  },
  {
    collection: "cashcollections",
    key: { status: 1, updatedAt: -1 },
    label: "cashcollections.status_updatedAt",
  },
  {
    collection: "cashcollections",
    key: { weekKey: 1, status: 1 },
    label: "cashcollections.week_status",
  },
  {
    collection: "cashcollections",
    key: { businessId: 1, weekKey: 1, status: 1 },
    label: "cashcollections.business_week_status",
  },
  {
    collection: "cashcollectionaudits",
    key: { weekKey: 1, createdAt: -1 },
    label: "cashcollectionaudits.week_createdAt",
  },
  {
    collection: "cashcollectionaudits",
    key: { businessId: 1, weekKey: 1, createdAt: -1 },
    label: "cashcollectionaudits.business_week_createdAt",
  },
  {
    collection: "drivers",
    key: { phoneHash: 1 },
    label: "drivers.phoneHash",
  },
  {
    collection: "cities",
    key: { code: 1 },
    unique: true,
    label: "cities.code unique",
  },
  {
    collection: "cities",
    key: { slug: 1 },
    unique: true,
    label: "cities.slug unique",
  },
  {
    collection: "cities",
    key: { name: 1, country: 1 },
    unique: true,
    label: "cities.name_country unique",
  },
  {
    collection: "drivers",
    key: { isActive: 1, name: 1, createdAt: -1 },
    label: "drivers.isActive_name_createdAt",
  },
  {
    collection: "dispatchaudits",
    key: { orderId: 1, createdAt: -1 },
    label: "dispatchaudits.order_createdAt",
  },
  {
    collection: "dispatchaudits",
    key: { businessId: 1, createdAt: -1 },
    label: "dispatchaudits.business_createdAt",
  },
  {
    collection: "dispatchaudits",
    key: { action: 1, createdAt: -1 },
    label: "dispatchaudits.action_createdAt",
  },
  {
    collection: "drivercashhandoffs",
    key: { orderId: 1 },
    unique: true,
    label: "drivercashhandoffs.orderId unique",
  },
  {
    collection: "drivercashhandoffs",
    key: { businessId: 1, weekKey: 1, status: 1 },
    label: "drivercashhandoffs.business_week_status",
  },
  {
    collection: "drivercashhandoffs",
    key: { driverId: 1, weekKey: 1, status: 1 },
    label: "drivercashhandoffs.driver_week_status",
  },
  {
    collection: "drivercashhandoffs",
    key: { "integrity.expectedHash": 1 },
    label: "drivercashhandoffs.integrity.expectedHash",
  },
  {
    collection: "drivercashhandoffaudits",
    key: { handoffId: 1, createdAt: -1 },
    label: "drivercashhandoffaudits.handoff_createdAt",
  },
  {
    collection: "drivercashhandoffaudits",
    key: { businessId: 1, weekKey: 1, createdAt: -1 },
    label: "drivercashhandoffaudits.business_week_createdAt",
  },
  {
    collection: "drivercashhandoffaudits",
    key: { action: 1, createdAt: -1 },
    label: "drivercashhandoffaudits.action_createdAt",
  },
  {
    collection: "riderpayouts",
    key: { orderId: 1 },
    unique: true,
    label: "riderpayouts.orderId unique",
  },
  {
    collection: "riderpayouts",
    key: { status: 1, createdAt: -1 },
    label: "riderpayouts.status_createdAt",
  },
  {
    collection: "riderpayouts",
    key: { driverId: 1, status: 1, createdAt: -1 },
    label: "riderpayouts.driverId_status_createdAt",
  },
  {
    collection: "backupruns",
    key: { createdAt: -1 },
    label: "backupruns.createdAt_desc",
  },
  {
    collection: "idempotencykeys",
    key: { keyHash: 1 },
    unique: true,
    label: "idempotencykeys.keyHash unique",
  },
  {
    collection: "idempotencykeys",
    key: { createdAt: 1 },
    label: "idempotencykeys.createdAt_ttl",
  },
  {
    collection: "ratelimithits",
    key: { scope: 1, keyHash: 1, windowKey: 1 },
    unique: true,
    label: "ratelimithits.scope_keyHash_windowKey unique",
  },
  {
    collection: "ratelimithits",
    key: { createdAt: 1 },
    label: "ratelimithits.createdAt_ttl",
  },
  {
    collection: "users",
    key: { phoneHash: 1 },
    unique: true,
    label: "users.phoneHash unique",
  },
  {
    collection: "opsevents",
    key: { weekKey: 1, type: 1, createdAt: -1 },
    label: "opsevents.week_type_createdAt",
  },
  {
    collection: "opsevents",
    key: { type: 1, createdAt: -1 },
    label: "opsevents.type_createdAt",
  },
  {
    collection: "opsevents",
    key: { "meta.route": 1, createdAt: -1 },
    label: "opsevents.meta.route_createdAt",
  },
  {
    collection: "opsevents",
    key: { "meta.ipHash": 1, createdAt: -1 },
    label: "opsevents.meta.ipHash_createdAt",
  },
  {
    collection: "opsevents",
    key: { businessId: 1, weekKey: 1, type: 1, createdAt: -1 },
    label: "opsevents.business_week_type_createdAt",
  },
  {
    collection: "opsevents",
    key: { businessId: 1, weekKey: 1, type: 1 },
    unique: true,
    label: "opsevents.business_week_type unique",
  },
  {
    collection: "financealerts",
    key: { businessId: 1, weekKey: 1, type: 1, dayKey: 1 },
    unique: true,
    label: "financealerts.business_week_type_day unique",
  },
  {
    collection: "financealerts",
    key: { status: 1, severity: 1, lastSeenAt: -1 },
    label: "financealerts.status_severity_lastSeenAt",
  },
  {
    collection: "financealerts",
    key: { weekKey: 1, status: 1, severity: 1 },
    label: "financealerts.week_status_severity",
  },
  {
    collection: "statementarchives",
    key: { businessId: 1, weekKey: 1, version: 1 },
    unique: true,
    label: "statementarchives.business_week_version unique",
  },
  {
    collection: "statementarchives",
    key: { generatedAt: -1 },
    label: "statementarchives.generatedAt_desc",
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
