import mongoose from "mongoose";
import { dbConnect } from "@/lib/mongodb";
import { OpsEvent } from "@/models/OpsEvent";
import type { FinanceMismatchRow } from "@/lib/financeAlignment";

export type FinanceAnomalyType =
  | "FIN_MISSING_SETTLEMENT"
  | "FIN_MISSING_CASH"
  | "FIN_HASH_MISMATCH"
  | "FIN_DIFF_OVER_THRESHOLD"
  | "FIN_STALE_SUBMISSION";

export type FinanceAnomalyEvent = {
  businessId: string;
  businessName: string;
  weekKey: string;
  type: FinanceAnomalyType;
  severity: "low" | "medium" | "high";
  meta: Record<string, unknown> | null;
};

type BulkResultLike = {
  upsertedCount?: number;
  nUpserted?: number;
};

function hoursSince(value: string | null, now: Date) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return (now.getTime() - date.getTime()) / (1000 * 60 * 60);
}

function pushEvent(target: FinanceAnomalyEvent[], event: FinanceAnomalyEvent, dedupe: Set<string>) {
  const key = `${event.businessId}:${event.weekKey}:${event.type}`;
  if (dedupe.has(key)) return;
  dedupe.add(key);
  target.push(event);
}

export function evaluateFinanceAnomalies(
  rows: FinanceMismatchRow[],
  ctx: { weekKey: string; staleSubmissionHours?: number; now?: Date }
): FinanceAnomalyEvent[] {
  const weekKey = String(ctx.weekKey || "").trim();
  const staleSubmissionHours = Math.max(1, Math.round(Number(ctx.staleSubmissionHours || 24)));
  const now = ctx.now || new Date();

  const events: FinanceAnomalyEvent[] = [];
  const dedupe = new Set<string>();

  for (const row of rows) {
    const baseMeta = {
      flags: row.flags,
      diffs: row.diffs,
      cashStatus: row.cash?.cashStatus || null,
    };

    if (row.flags.missingSettlement) {
      pushEvent(
        events,
        {
          businessId: row.businessId,
          businessName: row.businessName,
          weekKey,
          type: "FIN_MISSING_SETTLEMENT",
          severity: "high",
          meta: baseMeta,
        },
        dedupe
      );
    }

    if (row.flags.missingCashCollection || row.flags.settlementCollectedButNoCash) {
      pushEvent(
        events,
        {
          businessId: row.businessId,
          businessName: row.businessName,
          weekKey,
          type: "FIN_MISSING_CASH",
          severity: "high",
          meta: {
            ...baseMeta,
            settlementCollectedButNoCash: row.flags.settlementCollectedButNoCash,
          },
        },
        dedupe
      );
    }

    if (row.flags.hashMismatch || row.flags.integrityMismatch) {
      pushEvent(
        events,
        {
          businessId: row.businessId,
          businessName: row.businessName,
          weekKey,
          type: "FIN_HASH_MISMATCH",
          severity: "high",
          meta: {
            ...baseMeta,
            expectedHash: row.cash?.expectedHash || "",
            integrityStatus: row.cash?.integrityStatus || "ok",
          },
        },
        dedupe
      );
    }

    if (row.flags.diffOverThreshold) {
      pushEvent(
        events,
        {
          businessId: row.businessId,
          businessName: row.businessName,
          weekKey,
          type: "FIN_DIFF_OVER_THRESHOLD",
          severity: "medium",
          meta: baseMeta,
        },
        dedupe
      );
    }

    if (row.cash?.cashStatus === "submitted" && !row.cash?.verifiedAt) {
      const submittedHoursAgo = hoursSince(row.cash.submittedAt, now);
      if (submittedHoursAgo != null && submittedHoursAgo > staleSubmissionHours) {
        pushEvent(
          events,
          {
            businessId: row.businessId,
            businessName: row.businessName,
            weekKey,
            type: "FIN_STALE_SUBMISSION",
            severity: "low",
            meta: {
              ...baseMeta,
              staleSubmissionHours,
              submittedHoursAgo: Number(submittedHoursAgo.toFixed(2)),
            },
          },
          dedupe
        );
      }
    }
  }

  return events;
}

export async function writeFinanceAnomalyEvents(
  weekKey: string,
  events: FinanceAnomalyEvent[]
): Promise<{ inserted: number; skipped: number }> {
  await dbConnect();
  const normalizedWeekKey = String(weekKey || "").trim();

  const validEvents = events.filter(
    (event) =>
      event.weekKey === normalizedWeekKey &&
      mongoose.Types.ObjectId.isValid(String(event.businessId || ""))
  );
  if (!validEvents.length) return { inserted: 0, skipped: events.length };

  const ops = validEvents.map((event) => ({
    updateOne: {
      filter: {
        businessId: new mongoose.Types.ObjectId(event.businessId),
        weekKey: normalizedWeekKey,
        type: event.type,
      },
      update: {
        $setOnInsert: {
          type: event.type,
          reason: null,
          severity: event.severity,
          weekKey: normalizedWeekKey,
          businessId: new mongoose.Types.ObjectId(event.businessId),
          businessName: event.businessName,
          meta: event.meta || null,
        },
      },
      upsert: true,
    },
  }));

  const bulkWriteResult = await OpsEvent.bulkWrite(ops, { ordered: false });
  const resultLike = bulkWriteResult as unknown as BulkResultLike;
  const inserted = Math.max(
    0,
    Math.round(Number(resultLike.upsertedCount ?? resultLike.nUpserted ?? 0))
  );
  const skipped = Math.max(0, validEvents.length - inserted);
  return { inserted, skipped };
}
