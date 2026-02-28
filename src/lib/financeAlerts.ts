import mongoose from "mongoose";
import { dbConnect } from "@/lib/mongodb";
import { getBoolSetting } from "@/lib/appSettings";
import { OpsEvent } from "@/models/OpsEvent";
import { FinanceAlert } from "@/models/FinanceAlert";

const FINANCE_TYPES = [
  "FIN_MISSING_SETTLEMENT",
  "FIN_MISSING_CASH",
  "FIN_HASH_MISMATCH",
  "FIN_DIFF_OVER_THRESHOLD",
  "FIN_STALE_SUBMISSION",
] as const;

type FinanceType = (typeof FINANCE_TYPES)[number];

type OpsEventLean = {
  businessId: mongoose.Types.ObjectId;
  businessName: string;
  type: FinanceType;
  severity?: "high" | "medium" | "low" | null;
  meta?: Record<string, unknown> | null;
};

type FinanceAlertLean = {
  _id: mongoose.Types.ObjectId;
  businessId: mongoose.Types.ObjectId;
  weekKey: string;
  dayKey: string;
  type: FinanceType;
  status: "open" | "acknowledged" | "resolved";
};

type BulkWriteLike = {
  upsertedCount?: number;
  modifiedCount?: number;
  nUpserted?: number;
  nModified?: number;
};

function keyOf(businessId: string, weekKey: string, type: FinanceType) {
  return `${businessId}:${weekKey}:${type}`;
}

export function getUtcDayKey(dateInput = new Date()) {
  return dateInput.toISOString().slice(0, 10);
}

export async function upsertFinanceAlertsFromOpsEvents(
  weekKey: string,
  dayKey: string
): Promise<{ upserted: number; touched: number; skipped: number }> {
  await dbConnect();
  const normalizedWeekKey = String(weekKey || "").trim();
  const normalizedDayKey = String(dayKey || "").trim();
  if (!normalizedWeekKey || !normalizedDayKey) {
    return { upserted: 0, touched: 0, skipped: 0 };
  }

  const alertsEnabled = await getBoolSetting("finance_alerts_enabled", true);
  if (!alertsEnabled) {
    return { upserted: 0, touched: 0, skipped: 0 };
  }
  const reopenResolved = await getBoolSetting("finance_alerts_reopen_resolved", false);

  const events = await OpsEvent.find({
    weekKey: normalizedWeekKey,
    type: { $in: [...FINANCE_TYPES] },
  })
    .select("businessId businessName type severity meta")
    .lean<OpsEventLean[]>();
  if (!events.length) {
    return { upserted: 0, touched: 0, skipped: 0 };
  }

  const businessIds = Array.from(
    new Set(events.map((event) => String(event.businessId)).filter((id) => mongoose.Types.ObjectId.isValid(id)))
  ).map((id) => new mongoose.Types.ObjectId(id));

  const existingAlerts = await FinanceAlert.find({
    weekKey: normalizedWeekKey,
    businessId: { $in: businessIds },
    type: { $in: [...FINANCE_TYPES] },
  })
    .select("_id businessId weekKey dayKey type status")
    .sort({ dayKey: -1, lastSeenAt: -1, createdAt: -1 })
    .lean<FinanceAlertLean[]>();

  const latestByKey = new Map<string, FinanceAlertLean>();
  const currentDayByKey = new Map<string, FinanceAlertLean>();
  for (const alert of existingAlerts) {
    const businessId = String(alert.businessId);
    const key = keyOf(businessId, normalizedWeekKey, alert.type);
    if (!latestByKey.has(key)) latestByKey.set(key, alert);
    if (alert.dayKey === normalizedDayKey && !currentDayByKey.has(key)) {
      currentDayByKey.set(key, alert);
    }
  }

  const now = new Date();
  const ops: Array<{
    updateOne: {
      filter: Record<string, unknown>;
      update: Record<string, unknown>;
      upsert: true;
    };
  }> = [];
  let skipped = 0;

  for (const event of events) {
    const businessId = String(event.businessId);
    const type = event.type;
    const key = keyOf(businessId, normalizedWeekKey, type);
    const latest = latestByKey.get(key);
    const currentDay = currentDayByKey.get(key);
    const latestResolved = latest?.status === "resolved";

    if (!currentDay && latestResolved && !reopenResolved) {
      skipped += 1;
      continue;
    }

    const shouldReopen = reopenResolved && latestResolved;
    const setPayload: Record<string, unknown> = {
      businessName: String(event.businessName || "Business"),
      severity: (event.severity || "medium") as "high" | "medium" | "low",
      meta: event.meta || null,
      lastSeenAt: now,
    };

    if (shouldReopen) {
      setPayload.status = "open";
      setPayload.resolved = { by: null, at: null, note: null };
    }

    ops.push({
      updateOne: {
        filter: {
          businessId: new mongoose.Types.ObjectId(businessId),
          weekKey: normalizedWeekKey,
          type,
          dayKey: normalizedDayKey,
        },
        update: {
          $set: setPayload,
          $setOnInsert: {
            businessId: new mongoose.Types.ObjectId(businessId),
            weekKey: normalizedWeekKey,
            dayKey: normalizedDayKey,
            type,
            status: "open",
            firstSeenAt: now,
            ack: { by: null, at: null, note: null },
            resolved: { by: null, at: null, note: null },
          },
        },
        upsert: true,
      },
    });
  }

  if (!ops.length) {
    return { upserted: 0, touched: 0, skipped };
  }

  const result = (await FinanceAlert.bulkWrite(
    ops as unknown as Parameters<typeof FinanceAlert.bulkWrite>[0],
    { ordered: false }
  )) as unknown as BulkWriteLike;
  const upserted = Math.max(0, Math.round(Number(result.upsertedCount ?? result.nUpserted ?? 0)));
  const modified = Math.max(0, Math.round(Number(result.modifiedCount ?? result.nModified ?? 0)));
  return {
    upserted,
    touched: upserted + modified,
    skipped,
  };
}
