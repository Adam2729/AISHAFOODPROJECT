import mongoose from "mongoose";
import { dbConnect } from "@/lib/mongodb";
import { roundCurrency } from "@/lib/money";
import { getNumberSetting } from "@/lib/appSettings";
import { computeExpectedHash } from "@/lib/integrityHash";
import { Order } from "@/models/Order";
import { Settlement } from "@/models/Settlement";
import { CashCollection } from "@/models/CashCollection";
import { Business } from "@/models/Business";

type DeliveredAggRow = {
  _id: mongoose.Types.ObjectId;
  deliveredOrdersCount: number;
  deliveredGrossSubtotal: number;
  deliveredNetSubtotal: number;
  deliveredCommissionTotal: number;
};

type SettlementLean = {
  businessId: mongoose.Types.ObjectId;
  businessName?: string;
  weekKey: string;
  status?: "pending" | "collected" | "locked";
  ordersCount?: number;
  grossSubtotal?: number;
  feeTotal?: number;
};

type CashCollectionLean = {
  businessId: mongoose.Types.ObjectId;
  businessName?: string;
  weekKey: string;
  status?: "open" | "submitted" | "verified" | "disputed" | "closed";
  expected?: {
    ordersCount?: number;
    grossSubtotal?: number;
    promoDiscountTotal?: number;
    netSubtotal?: number;
    commissionTotal?: number;
  };
  reported?: {
    cashCollected?: number | null;
    grossSubtotal?: number | null;
    netSubtotal?: number | null;
    commissionTotal?: number | null;
    ordersCount?: number | null;
    reportedAt?: Date | null;
  } | null;
  integrity?: {
    expectedHash?: string;
    computedAt?: Date | null;
    status?: "ok" | "mismatch";
  } | null;
  submittedAt?: Date | null;
  verifiedAt?: Date | null;
  updatedAt?: Date | null;
};

type BusinessLean = {
  _id: mongoose.Types.ObjectId;
  name?: string;
};

type NumericDiff = number | null;

export type FinanceMismatchRow = {
  businessId: string;
  businessName: string;
  weekKey: string;
  deliveredAgg: {
    deliveredOrdersCount: number;
    deliveredGrossSubtotal: number;
    deliveredNetSubtotal: number;
    deliveredCommissionTotal: number;
  };
  settlement: {
    settlementOrdersCount: number;
    settlementGrossSubtotal: number;
    settlementFeeTotal: number;
    settlementStatus: "pending" | "collected" | "locked" | null;
  } | null;
  cash: {
    cashStatus: "open" | "submitted" | "verified" | "disputed" | "closed";
    reportedGross: number | null;
    reportedCommission: number | null;
    reportedNet: number | null;
    expectedHash: string;
    integrityStatus: "ok" | "mismatch";
    verifiedAt: string | null;
    submittedAt: string | null;
  } | null;
  diffs: {
    diffOrders: NumericDiff;
    diffGrossSubtotal: NumericDiff;
    diffFeeTotal: NumericDiff;
    diffCashNetVsDeliveredNet: NumericDiff;
    diffCashCommissionVsDeliveredCommission: NumericDiff;
  };
  flags: {
    missingSettlement: boolean;
    missingCashCollection: boolean;
    settlementCollectedButNoCash: boolean;
    hashMismatch: boolean;
    integrityMismatch: boolean;
    diffOverThreshold: boolean;
  };
};

type FinanceAlignmentSummary = {
  totalRows: number;
  returnedRows: number;
  mismatchRows: number;
  missingSettlementCount: number;
  missingCashCount: number;
  hashMismatchCount: number;
  overThresholdCount: number;
  thresholds: {
    ordersThreshold: number;
    moneyThresholdRdp: number;
  };
};

function asNumber(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeMoney(value: unknown) {
  return roundCurrency(asNumber(value, 0));
}

function toIsoOrNull(value: unknown) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function moneyDiff(a: number | null, b: number | null): number | null {
  if (a == null || b == null) return null;
  return roundCurrency(a - b);
}

function countDiff(a: number | null, b: number | null): number | null {
  if (a == null || b == null) return null;
  return Math.round(a - b);
}

function hasMoneyOverThreshold(value: number | null, threshold: number) {
  if (value == null) return false;
  return Math.abs(value) > threshold;
}

function hasCountOverThreshold(value: number | null, threshold: number) {
  if (value == null) return false;
  return Math.abs(value) > threshold;
}

function compareRows(a: FinanceMismatchRow, b: FinanceMismatchRow) {
  const aGroup =
    a.flags.missingSettlement || a.flags.missingCashCollection
      ? 0
      : a.flags.hashMismatch || a.flags.integrityMismatch
        ? 1
        : a.flags.diffOverThreshold
          ? 2
          : 3;
  const bGroup =
    b.flags.missingSettlement || b.flags.missingCashCollection
      ? 0
      : b.flags.hashMismatch || b.flags.integrityMismatch
        ? 1
        : b.flags.diffOverThreshold
          ? 2
          : 3;
  if (aGroup !== bGroup) return aGroup - bGroup;
  const aAbs = Math.abs(Number(a.diffs.diffFeeTotal || 0));
  const bAbs = Math.abs(Number(b.diffs.diffFeeTotal || 0));
  if (aAbs !== bAbs) return bAbs - aAbs;
  return a.businessName.localeCompare(b.businessName, "es", { sensitivity: "base" });
}

export async function computeFinanceAlignmentForWeek(
  weekKey: string,
  opts?: { limit?: number; businessId?: string | null }
): Promise<{ rows: FinanceMismatchRow[]; summary: FinanceAlignmentSummary }> {
  const normalizedWeekKey = String(weekKey || "").trim();
  if (!normalizedWeekKey) {
    throw new Error("weekKey is required.");
  }

  const requestedBusinessId = String(opts?.businessId || "").trim();
  if (requestedBusinessId && !mongoose.Types.ObjectId.isValid(requestedBusinessId)) {
    throw new Error("Invalid businessId.");
  }
  const limit =
    typeof opts?.limit === "number" && Number.isFinite(opts.limit)
      ? Math.max(1, Math.min(5000, Math.floor(opts.limit)))
      : 200;

  const businessFilterObjectId = requestedBusinessId
    ? new mongoose.Types.ObjectId(requestedBusinessId)
    : null;

  await dbConnect();
  const [ordersThresholdRaw, moneyThresholdRaw] = await Promise.all([
    getNumberSetting("finance_diff_orders_threshold", 0),
    getNumberSetting("finance_diff_money_threshold_rdp", 50),
  ]);
  const ordersThreshold = Math.max(0, Math.floor(asNumber(ordersThresholdRaw, 0)));
  const moneyThreshold = Math.max(0, normalizeMoney(moneyThresholdRaw));

  const matchWithBusiness = businessFilterObjectId ? { businessId: businessFilterObjectId } : {};
  const [deliveredAggRows, settlementRows, cashRows] = await Promise.all([
    Order.aggregate<DeliveredAggRow>([
      {
        $match: {
          ...matchWithBusiness,
          status: "delivered",
          "settlement.counted": true,
          "settlement.weekKey": normalizedWeekKey,
        },
      },
      {
        $group: {
          _id: "$businessId",
          deliveredOrdersCount: { $sum: 1 },
          deliveredGrossSubtotal: { $sum: { $ifNull: ["$subtotal", 0] } },
          deliveredNetSubtotal: { $sum: { $ifNull: ["$total", 0] } },
          deliveredCommissionTotal: { $sum: { $ifNull: ["$commissionAmount", 0] } },
        },
      },
    ]),
    Settlement.find({
      ...matchWithBusiness,
      weekKey: normalizedWeekKey,
    })
      .select("businessId businessName weekKey status ordersCount grossSubtotal feeTotal")
      .lean<SettlementLean[]>(),
    CashCollection.find({
      ...matchWithBusiness,
      weekKey: normalizedWeekKey,
    })
      .select(
        "businessId businessName weekKey status expected reported integrity submittedAt verifiedAt updatedAt"
      )
      .lean<CashCollectionLean[]>(),
  ]);

  const deliveredByBusiness = new Map<
    string,
    {
      deliveredOrdersCount: number;
      deliveredGrossSubtotal: number;
      deliveredNetSubtotal: number;
      deliveredCommissionTotal: number;
    }
  >();
  for (const row of deliveredAggRows) {
    deliveredByBusiness.set(String(row._id), {
      deliveredOrdersCount: Math.max(0, Math.round(asNumber(row.deliveredOrdersCount, 0))),
      deliveredGrossSubtotal: normalizeMoney(row.deliveredGrossSubtotal),
      deliveredNetSubtotal: normalizeMoney(row.deliveredNetSubtotal),
      deliveredCommissionTotal: normalizeMoney(row.deliveredCommissionTotal),
    });
  }

  const settlementByBusiness = new Map<string, SettlementLean>();
  for (const row of settlementRows) {
    settlementByBusiness.set(String(row.businessId), row);
  }

  const cashByBusiness = new Map<string, CashCollectionLean>();
  for (const row of cashRows) {
    cashByBusiness.set(String(row.businessId), row);
  }

  const businessIds = new Set<string>();
  for (const businessId of deliveredByBusiness.keys()) businessIds.add(businessId);
  for (const businessId of settlementByBusiness.keys()) businessIds.add(businessId);
  for (const businessId of cashByBusiness.keys()) businessIds.add(businessId);

  const businessObjectIds = Array.from(businessIds)
    .filter((id) => mongoose.Types.ObjectId.isValid(id))
    .map((id) => new mongoose.Types.ObjectId(id));
  const businessRows = businessObjectIds.length
    ? await Business.find({ _id: { $in: businessObjectIds } })
        .select("_id name")
        .lean<BusinessLean[]>()
    : [];
  const businessNameById = new Map<string, string>();
  for (const row of businessRows) {
    businessNameById.set(String(row._id), String(row.name || ""));
  }

  const rows: FinanceMismatchRow[] = [];
  for (const businessId of businessIds) {
    const delivered = deliveredByBusiness.get(businessId) || {
      deliveredOrdersCount: 0,
      deliveredGrossSubtotal: 0,
      deliveredNetSubtotal: 0,
      deliveredCommissionTotal: 0,
    };
    const settlement = settlementByBusiness.get(businessId) || null;
    const cash = cashByBusiness.get(businessId) || null;

    const settlementSnapshot = settlement
      ? {
          settlementOrdersCount: Math.max(0, Math.round(asNumber(settlement.ordersCount, 0))),
          settlementGrossSubtotal: normalizeMoney(settlement.grossSubtotal),
          settlementFeeTotal: normalizeMoney(settlement.feeTotal),
          settlementStatus: (settlement.status || null) as "pending" | "collected" | "locked" | null,
        }
      : null;

    const reportedNet = cash
      ? (() => {
          if (cash.reported?.netSubtotal != null) return normalizeMoney(cash.reported.netSubtotal);
          if (cash.reported?.cashCollected != null) return normalizeMoney(cash.reported.cashCollected);
          return null;
        })()
      : null;
    const reportedCommission = cash
      ? cash.reported?.commissionTotal != null
        ? normalizeMoney(cash.reported.commissionTotal)
        : null
      : null;
    const reportedGross = cash
      ? (() => {
          if (cash.reported?.grossSubtotal != null) return normalizeMoney(cash.reported.grossSubtotal);
          if (reportedNet != null && reportedCommission != null) {
            return roundCurrency(reportedNet + reportedCommission);
          }
          return null;
        })()
      : null;

    const computedExpectedHash = cash
      ? computeExpectedHash({
          businessId,
          weekKey: normalizedWeekKey,
          expected: {
            ordersCount: Math.max(0, Math.round(asNumber(cash.expected?.ordersCount, 0))),
            grossSubtotal: normalizeMoney(cash.expected?.grossSubtotal),
            promoDiscountTotal: normalizeMoney(cash.expected?.promoDiscountTotal),
            netSubtotal: normalizeMoney(cash.expected?.netSubtotal),
            commissionTotal: normalizeMoney(cash.expected?.commissionTotal),
          },
        })
      : "";

    const storedExpectedHash = String(cash?.integrity?.expectedHash || "").trim();
    const hashMatches = Boolean(cash) && Boolean(storedExpectedHash) && storedExpectedHash === computedExpectedHash;
    const integrityStatus = !cash
      ? "ok"
      : cash.integrity?.status === "mismatch"
        ? "mismatch"
        : hashMatches
          ? "ok"
          : "mismatch";
    const integrityMismatch = Boolean(cash) && cash?.integrity?.status === "mismatch";
    const hashMismatch = Boolean(cash) && (integrityMismatch || !hashMatches);

    const cashSnapshot = cash
      ? {
          cashStatus: (cash.status || "open") as "open" | "submitted" | "verified" | "disputed" | "closed",
          reportedGross,
          reportedCommission,
          reportedNet,
          expectedHash: storedExpectedHash,
          integrityStatus: integrityStatus as "ok" | "mismatch",
          verifiedAt: toIsoOrNull(cash.verifiedAt || (cash.status === "verified" || cash.status === "closed" ? cash.updatedAt : null)),
          submittedAt: toIsoOrNull(cash.submittedAt || cash.reported?.reportedAt || null),
        }
      : null;

    const diffOrders = countDiff(
      settlementSnapshot?.settlementOrdersCount ?? null,
      delivered.deliveredOrdersCount
    );
    const diffGrossSubtotal = moneyDiff(
      settlementSnapshot?.settlementGrossSubtotal ?? null,
      delivered.deliveredGrossSubtotal
    );
    const diffFeeTotal = moneyDiff(
      settlementSnapshot?.settlementFeeTotal ?? null,
      delivered.deliveredCommissionTotal
    );
    const diffCashNetVsDeliveredNet = moneyDiff(cashSnapshot?.reportedNet ?? null, delivered.deliveredNetSubtotal);
    const diffCashCommissionVsDeliveredCommission = moneyDiff(
      cashSnapshot?.reportedCommission ?? null,
      delivered.deliveredCommissionTotal
    );

    const diffOverThreshold =
      hasCountOverThreshold(diffOrders, ordersThreshold) ||
      hasMoneyOverThreshold(diffGrossSubtotal, moneyThreshold) ||
      hasMoneyOverThreshold(diffFeeTotal, moneyThreshold) ||
      hasMoneyOverThreshold(diffCashNetVsDeliveredNet, moneyThreshold) ||
      hasMoneyOverThreshold(diffCashCommissionVsDeliveredCommission, moneyThreshold);

    const missingSettlement = !settlementSnapshot;
    const missingCashCollection = !cashSnapshot;
    const settlementCollectedButNoCash =
      !cashSnapshot &&
      Boolean(
        settlementSnapshot &&
          (settlementSnapshot.settlementStatus === "collected" ||
            settlementSnapshot.settlementStatus === "locked")
      );

    rows.push({
      businessId,
      businessName:
        String(settlement?.businessName || "").trim() ||
        String(cash?.businessName || "").trim() ||
        String(businessNameById.get(businessId) || "").trim() ||
        "Business",
      weekKey: normalizedWeekKey,
      deliveredAgg: delivered,
      settlement: settlementSnapshot,
      cash: cashSnapshot,
      diffs: {
        diffOrders,
        diffGrossSubtotal,
        diffFeeTotal,
        diffCashNetVsDeliveredNet,
        diffCashCommissionVsDeliveredCommission,
      },
      flags: {
        missingSettlement,
        missingCashCollection,
        settlementCollectedButNoCash,
        hashMismatch,
        integrityMismatch,
        diffOverThreshold,
      },
    });
  }

  rows.sort(compareRows);
  const summary = rows.reduce(
    (acc, row) => {
      const isMismatch =
        row.flags.missingSettlement ||
        row.flags.missingCashCollection ||
        row.flags.settlementCollectedButNoCash ||
        row.flags.hashMismatch ||
        row.flags.integrityMismatch ||
        row.flags.diffOverThreshold;
      if (isMismatch) acc.mismatchRows += 1;
      if (row.flags.missingSettlement) acc.missingSettlementCount += 1;
      if (row.flags.missingCashCollection) acc.missingCashCount += 1;
      if (row.flags.hashMismatch) acc.hashMismatchCount += 1;
      if (row.flags.diffOverThreshold) acc.overThresholdCount += 1;
      return acc;
    },
    {
      totalRows: rows.length,
      returnedRows: Math.min(rows.length, limit),
      mismatchRows: 0,
      missingSettlementCount: 0,
      missingCashCount: 0,
      hashMismatchCount: 0,
      overThresholdCount: 0,
      thresholds: {
        ordersThreshold,
        moneyThresholdRdp: moneyThreshold,
      },
    } satisfies FinanceAlignmentSummary
  );

  return {
    rows: rows.slice(0, limit),
    summary,
  };
}
