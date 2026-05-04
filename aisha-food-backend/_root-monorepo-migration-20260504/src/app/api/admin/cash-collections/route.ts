import { dbConnect } from "@/lib/mongodb";
import { ok, fail } from "@/lib/apiResponse";
import { requireAdminKey } from "@/lib/adminAuth";
import { getWeekKey } from "@/lib/geo";
import { roundCurrency } from "@/lib/money";
import { getBoolSetting } from "@/lib/appSettings";
import { evaluateProofCompleteness } from "@/lib/cashCollectionProof";
import { CashCollection } from "@/models/CashCollection";

type ApiError = Error & { status?: number; code?: string };

type CashCollectionLean = {
  _id: string;
  businessId: string;
  businessName: string;
  weekKey: string;
  status: "open" | "submitted" | "verified" | "disputed" | "closed";
  expected: {
    ordersCount: number;
    grossSubtotal: number;
    promoDiscountTotal: number;
    netSubtotal: number;
    commissionTotal: number;
  };
  reported?: {
    cashCollected?: number | null;
    grossSubtotal?: number | null;
    netSubtotal?: number | null;
    commissionTotal?: number | null;
    ordersCount?: number | null;
    collectorName?: string | null;
    collectionMethod?: "in_person" | "bank_deposit" | "bank_transfer" | "transfer" | "pickup" | "other" | null;
    receiptPhotoUrl?: string | null;
    receiptRef?: string | null;
    reportedAt?: Date | null;
  } | null;
  discrepancy?: {
    cashDiff?: number;
    ordersDiff?: number;
  } | null;
  integrity?: {
    expectedHash?: string;
    computedAt?: Date | null;
    status?: "ok" | "mismatch";
  } | null;
  driverCash?: {
    driverCollectedTotalRdp?: number;
    driverHandedTotalRdp?: number;
    driverDisputedTotalRdp?: number;
    merchantCashReceivedTotalRdp?: number;
    mismatchSignal?: boolean;
  } | null;
  submittedAt?: Date | null;
  verifiedAt?: Date | null;
  updatedAt?: Date;
};

const STATUS_ORDER: Record<CashCollectionLean["status"], number> = {
  disputed: 0,
  submitted: 1,
  open: 2,
  verified: 3,
  closed: 4,
};

function safeNumber(value: unknown) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

export async function GET(req: Request) {
  try {
    requireAdminKey(req);
    const url = new URL(req.url);
    const weekKey = String(url.searchParams.get("weekKey") || "").trim() || getWeekKey(new Date());
    const status = String(url.searchParams.get("status") || "").trim();
    const q = String(url.searchParams.get("q") || "").trim();
    const limitRaw = Number(url.searchParams.get("limit") || 100);
    const limit = Math.max(1, Math.min(500, Math.floor(Number.isFinite(limitRaw) ? limitRaw : 100)));

    if (status && !["open", "submitted", "verified", "disputed", "closed"].includes(status)) {
      return fail("VALIDATION_ERROR", "Invalid status.", 400);
    }

    const match: Record<string, unknown> = { weekKey };
    if (status) match.status = status;
    if (q) {
      match.businessName = { $regex: q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), $options: "i" };
    }

    await dbConnect();
    const proofRequiredNonInPerson = await getBoolSetting(
      "finance_proof_required_non_in_person",
      true
    );
    const rows = await CashCollection.find(match)
      .select(
        "_id businessId businessName weekKey status expected reported discrepancy integrity driverCash submittedAt verifiedAt updatedAt"
      )
      .limit(limit)
      .lean<CashCollectionLean[]>();

    const normalizedRows = rows.map((row) => {
      const proof = row.reported
        ? evaluateProofCompleteness(row.reported, proofRequiredNonInPerson)
        : { proofComplete: true, missingFields: [] };
      return {
        id: String(row._id),
        businessId: String(row.businessId),
        businessName: String(row.businessName || ""),
        weekKey: String(row.weekKey || ""),
        status: row.status,
        expected: {
          ordersCount: Math.max(0, Math.round(safeNumber(row.expected?.ordersCount))),
          grossSubtotal: roundCurrency(safeNumber(row.expected?.grossSubtotal)),
          promoDiscountTotal: roundCurrency(safeNumber(row.expected?.promoDiscountTotal)),
          netSubtotal: roundCurrency(safeNumber(row.expected?.netSubtotal)),
          commissionTotal: roundCurrency(safeNumber(row.expected?.commissionTotal)),
        },
        reported: {
          cashCollected:
            row.reported?.cashCollected == null ? null : roundCurrency(safeNumber(row.reported.cashCollected)),
          grossSubtotal:
            row.reported?.grossSubtotal == null ? null : roundCurrency(safeNumber(row.reported.grossSubtotal)),
          netSubtotal:
            row.reported?.netSubtotal == null ? null : roundCurrency(safeNumber(row.reported.netSubtotal)),
          commissionTotal:
            row.reported?.commissionTotal == null
              ? null
              : roundCurrency(safeNumber(row.reported.commissionTotal)),
          ordersCount: row.reported?.ordersCount == null ? null : Math.round(safeNumber(row.reported.ordersCount)),
          collectorName: row.reported?.collectorName || null,
          collectionMethod: row.reported?.collectionMethod || null,
          receiptPhotoUrl: row.reported?.receiptPhotoUrl || null,
          receiptRef: row.reported?.receiptRef || null,
          reportedAt: row.reported?.reportedAt || null,
        },
        discrepancy: {
          cashDiff: roundCurrency(safeNumber(row.discrepancy?.cashDiff)),
          ordersDiff: Math.round(safeNumber(row.discrepancy?.ordersDiff)),
        },
        integrity: {
          expectedHash: String(row.integrity?.expectedHash || ""),
          computedAt: row.integrity?.computedAt || null,
          status: row.integrity?.status || "ok",
        },
        driverCash: {
          driverCollectedTotalRdp: roundCurrency(
            safeNumber(row.driverCash?.driverCollectedTotalRdp)
          ),
          driverHandedTotalRdp: roundCurrency(safeNumber(row.driverCash?.driverHandedTotalRdp)),
          driverDisputedTotalRdp: roundCurrency(
            safeNumber(row.driverCash?.driverDisputedTotalRdp)
          ),
          merchantCashReceivedTotalRdp: roundCurrency(
            safeNumber(row.driverCash?.merchantCashReceivedTotalRdp)
          ),
          mismatchSignal: Boolean(row.driverCash?.mismatchSignal),
        },
        proofComplete: proof.proofComplete,
        missingProofFields: proof.missingFields,
        submittedAt: row.submittedAt || null,
        verifiedAt: row.verifiedAt || null,
        updatedAt: row.updatedAt || null,
      };
    });

    normalizedRows.sort((a, b) => {
      const statusDiff = STATUS_ORDER[a.status] - STATUS_ORDER[b.status];
      if (statusDiff !== 0) return statusDiff;
      if (a.status === "submitted" && b.status === "submitted") {
        const aAbs = Math.abs(Number(a.discrepancy.cashDiff || 0));
        const bAbs = Math.abs(Number(b.discrepancy.cashDiff || 0));
        if (aAbs !== bAbs) return bAbs - aAbs;
      }
      const aUpdated = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
      const bUpdated = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
      return bUpdated - aUpdated;
    });

    const summary = normalizedRows.reduce(
      (acc, row) => {
        acc.totalExpectedNet = roundCurrency(acc.totalExpectedNet + row.expected.netSubtotal);
        acc.totalReportedCash = roundCurrency(acc.totalReportedCash + Number(row.reported.cashCollected || 0));
        acc.totalCashDiff = roundCurrency(acc.totalCashDiff + row.discrepancy.cashDiff);
        if (row.status === "submitted") acc.submittedCount += 1;
        if (row.status === "verified") acc.verifiedCount += 1;
        if (row.status === "disputed") acc.disputedCount += 1;
        if (row.status === "open") acc.openCount += 1;
        if (row.status === "closed") acc.closedCount += 1;
        acc.driverCollectedTotalRdp = roundCurrency(
          acc.driverCollectedTotalRdp + Number(row.driverCash.driverCollectedTotalRdp || 0)
        );
        acc.driverHandedTotalRdp = roundCurrency(
          acc.driverHandedTotalRdp + Number(row.driverCash.driverHandedTotalRdp || 0)
        );
        acc.driverDisputedTotalRdp = roundCurrency(
          acc.driverDisputedTotalRdp + Number(row.driverCash.driverDisputedTotalRdp || 0)
        );
        acc.driverMismatchCount += row.driverCash.mismatchSignal ? 1 : 0;
        return acc;
      },
      {
        totalExpectedNet: 0,
        totalReportedCash: 0,
        totalCashDiff: 0,
        submittedCount: 0,
        verifiedCount: 0,
        disputedCount: 0,
        openCount: 0,
        closedCount: 0,
        driverCollectedTotalRdp: 0,
        driverHandedTotalRdp: 0,
        driverDisputedTotalRdp: 0,
        driverMismatchCount: 0,
      }
    );

    return ok({
      weekKey,
      rows: normalizedRows,
      summary,
    });
  } catch (error: unknown) {
    const err = error as ApiError;
    return fail(
      err.code || "SERVER_ERROR",
      err.message || "Could not load cash collections.",
      err.status || 500
    );
  }
}
