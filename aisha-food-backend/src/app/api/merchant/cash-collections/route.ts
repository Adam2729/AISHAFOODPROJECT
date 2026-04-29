import mongoose from "mongoose";
import { dbConnect } from "@/lib/mongodb";
import { ok, fail } from "@/lib/apiResponse";
import { getWeekKey } from "@/lib/geo";
import { requireMerchantSession } from "@/lib/merchantAuth";
import { requireMerchantBusinessAvailable } from "@/lib/merchantBusiness";
import { upsertExpectedCashCollectionsForWeek } from "@/lib/cashCollectionCompute";
import { getBoolSetting } from "@/lib/appSettings";
import { evaluateProofCompleteness } from "@/lib/cashCollectionProof";
import { CashCollection } from "@/models/CashCollection";

type ApiError = Error & { status?: number; code?: string };

type CashCollectionLean = {
  _id: mongoose.Types.ObjectId;
  businessId: mongoose.Types.ObjectId;
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
  notes?: string | null;
  integrity?: {
    expectedHash?: string;
    computedAt?: Date | null;
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

export async function GET(req: Request) {
  try {
    const session = requireMerchantSession(req);
    const weekKey = String(new URL(req.url).searchParams.get("weekKey") || "").trim() || getWeekKey(new Date());

    await dbConnect();
    await requireMerchantBusinessAvailable(session.businessId);

    const businessObjectId = new mongoose.Types.ObjectId(session.businessId);
    let row = await CashCollection.findOne({
      businessId: businessObjectId,
      weekKey,
    }).lean<CashCollectionLean | null>();

    if (!row) {
      await upsertExpectedCashCollectionsForWeek({
        weekKey,
        businessIds: [businessObjectId],
      });
      row = await CashCollection.findOne({
        businessId: businessObjectId,
        weekKey,
      }).lean<CashCollectionLean | null>();
    }

    if (!row) return fail("NOT_FOUND", "Cash collection sheet not found.", 404);
    const proofRequiredNonInPerson = await getBoolSetting(
      "finance_proof_required_non_in_person",
      true
    );
    const proof = row.reported
      ? evaluateProofCompleteness(row.reported, proofRequiredNonInPerson)
      : { proofComplete: true, missingFields: [] };

    return ok({
      cashCollection: {
        id: String(row._id),
        businessId: String(row.businessId),
        businessName: row.businessName,
        weekKey: row.weekKey,
        status: row.status,
        expected: row.expected,
        reported: row.reported || null,
        discrepancy: row.discrepancy || { cashDiff: 0, ordersDiff: 0 },
        notes: row.notes || null,
        integrity: {
          expectedHash: String(row.integrity?.expectedHash || ""),
          computedAt: row.integrity?.computedAt || null,
        },
        driverCash: {
          driverCollectedTotalRdp: Number(row.driverCash?.driverCollectedTotalRdp || 0),
          driverHandedTotalRdp: Number(row.driverCash?.driverHandedTotalRdp || 0),
          driverDisputedTotalRdp: Number(row.driverCash?.driverDisputedTotalRdp || 0),
          merchantCashReceivedTotalRdp: Number(row.driverCash?.merchantCashReceivedTotalRdp || 0),
          mismatchSignal: Boolean(row.driverCash?.mismatchSignal),
        },
        canSubmit: row.status === "open" || row.status === "disputed",
        proofComplete: proof.proofComplete,
        missingProofFields: proof.missingFields,
        submittedAt: row.submittedAt || null,
        verifiedAt: row.verifiedAt || null,
        updatedAt: row.updatedAt || null,
      },
    });
  } catch (error: unknown) {
    const err = error as ApiError;
    return fail(
      err.code || "SERVER_ERROR",
      err.message || "Could not load cash collection sheet.",
      err.status || 500
    );
  }
}
