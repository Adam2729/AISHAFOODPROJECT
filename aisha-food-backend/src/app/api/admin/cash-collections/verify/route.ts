import mongoose from "mongoose";
import { dbConnect } from "@/lib/mongodb";
import { ok, fail, readJson } from "@/lib/apiResponse";
import { requireAdminKey } from "@/lib/adminAuth";
import { roundCurrency } from "@/lib/money";
import { getBoolSetting } from "@/lib/appSettings";
import { evaluateProofCompleteness } from "@/lib/cashCollectionProof";
import { CashCollection } from "@/models/CashCollection";
import { CashCollectionAudit } from "@/models/CashCollectionAudit";

type ApiError = Error & { status?: number; code?: string };

type Body = {
  businessId?: string;
  weekKey?: string;
  action?: "verify" | "dispute" | "close" | "reset_open";
  note?: string;
  confirm?: string;
};

type CashCollectionLean = {
  _id: mongoose.Types.ObjectId;
  businessId: mongoose.Types.ObjectId;
  businessName: string;
  weekKey: string;
  status: "open" | "submitted" | "verified" | "disputed" | "closed";
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
  expected?: {
    ordersCount?: number;
    grossSubtotal?: number;
    promoDiscountTotal?: number;
    netSubtotal?: number;
    commissionTotal?: number;
  };
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

const ACTION_PRECONDITIONS: Record<NonNullable<Body["action"]>, Array<CashCollectionLean["status"]>> = {
  verify: ["submitted"],
  dispute: ["submitted", "verified"],
  close: ["verified"],
  reset_open: ["disputed", "submitted"],
};

function buildAuditSnapshot(input: CashCollectionLean) {
  return {
    status: input.status,
    reported: {
      cashCollected: input.reported?.cashCollected ?? null,
      grossSubtotal: input.reported?.grossSubtotal ?? null,
      netSubtotal: input.reported?.netSubtotal ?? null,
      commissionTotal: input.reported?.commissionTotal ?? null,
      ordersCount: input.reported?.ordersCount ?? null,
      collectorName: input.reported?.collectorName ?? null,
      collectionMethod: input.reported?.collectionMethod ?? null,
      receiptPhotoUrl: input.reported?.receiptPhotoUrl ?? null,
      receiptRef: input.reported?.receiptRef ?? null,
      reportedAt: input.reported?.reportedAt ?? null,
    },
    discrepancy: {
      cashDiff: roundCurrency(Number(input.discrepancy?.cashDiff || 0)),
      ordersDiff: Math.round(Number(input.discrepancy?.ordersDiff || 0)),
    },
  };
}

function actionToAudit(action: NonNullable<Body["action"]>) {
  if (action === "verify") return "ADMIN_VERIFIED" as const;
  if (action === "dispute") return "ADMIN_DISPUTED" as const;
  if (action === "close") return "ADMIN_CLOSED" as const;
  return "RESET_TO_OPEN" as const;
}

export async function POST(req: Request) {
  try {
    requireAdminKey(req);
    const body = await readJson<Body>(req);
    const businessId = String(body.businessId || "").trim();
    const weekKey = String(body.weekKey || "").trim();
    const action = body.action;
    const note = String(body.note || "").trim();
    const confirm = String(body.confirm || "").trim();

    if (!mongoose.Types.ObjectId.isValid(businessId)) {
      return fail("VALIDATION_ERROR", "Invalid businessId.", 400);
    }
    if (!weekKey) return fail("VALIDATION_ERROR", "weekKey is required.", 400);
    if (!action || !(action in ACTION_PRECONDITIONS)) {
      return fail("VALIDATION_ERROR", "Invalid action.", 400);
    }
    if (confirm !== "VERIFY") {
      return fail("VALIDATION_ERROR", 'confirm must equal "VERIFY".', 400);
    }
    if (action === "dispute" && !note) {
      return fail("VALIDATION_ERROR", "note is required for dispute.", 400);
    }
    if (note.length > 500) {
      return fail("VALIDATION_ERROR", "note must be 500 characters or less.", 400);
    }

    await dbConnect();
    const businessObjectId = new mongoose.Types.ObjectId(businessId);

    const before = await CashCollection.findOne({
      businessId: businessObjectId,
      weekKey,
    }).lean<CashCollectionLean | null>();
    if (!before) return fail("NOT_FOUND", "Cash collection not found.", 404);

    const proofRequiredNonInPerson = await getBoolSetting(
      "finance_proof_required_non_in_person",
      true
    );
    const proof = evaluateProofCompleteness(before.reported || null, proofRequiredNonInPerson);
    const proofIsRequired = action === "verify" || action === "close";
    if (proofIsRequired && !proof.proofComplete) {
      return fail(
        "PROOF_INCOMPLETE",
        "Proof is incomplete for verification/close.",
        400,
        { missingFields: proof.missingFields }
      );
    }

    const allowedStatuses = ACTION_PRECONDITIONS[action];
    const updateSet: Record<string, unknown> = {
      updatedAt: new Date(),
    };
    if (action === "verify") {
      updateSet.status = "verified";
      updateSet.verifiedAt = new Date();
    }
    if (action === "dispute") {
      updateSet.status = "disputed";
      updateSet.notes = note;
    }
    if (action === "close") {
      updateSet.status = "closed";
      updateSet.verifiedAt = before.verifiedAt || new Date();
      if (note) updateSet.notes = note;
    }
    if (action === "reset_open") {
      const driverHanded = roundCurrency(Number(before.driverCash?.driverHandedTotalRdp || 0));
      updateSet.status = "open";
      updateSet.reported = {
        cashCollected: null,
        grossSubtotal: null,
        netSubtotal: null,
        commissionTotal: null,
        ordersCount: null,
        collectorName: null,
        collectionMethod: null,
        receiptPhotoUrl: null,
        receiptRef: null,
        reportedAt: null,
      };
      updateSet.discrepancy = {
        cashDiff: 0,
        ordersDiff: 0,
      };
      updateSet.driverCash = {
        driverCollectedTotalRdp: roundCurrency(Number(before.driverCash?.driverCollectedTotalRdp || 0)),
        driverHandedTotalRdp: driverHanded,
        driverDisputedTotalRdp: roundCurrency(Number(before.driverCash?.driverDisputedTotalRdp || 0)),
        merchantCashReceivedTotalRdp: 0,
        mismatchSignal: 0 < driverHanded,
      };
      updateSet.submittedByMerchantId = null;
      updateSet.submittedAt = null;
      updateSet.verifiedAt = null;
      if (note) updateSet.notes = note;
    }

    const updated = await CashCollection.findOneAndUpdate(
      {
        businessId: businessObjectId,
        weekKey,
        status: { $in: allowedStatuses },
      },
      { $set: updateSet },
      { returnDocument: "after" }
    ).lean<CashCollectionLean | null>();

    if (!updated) {
      return fail(
        "INVALID_STATE",
        `Action ${action} is not allowed from current status.`,
        409
      );
    }
    const updatedProof = updated.reported
      ? evaluateProofCompleteness(updated.reported, proofRequiredNonInPerson)
      : { proofComplete: true, missingFields: [] as string[] };

    try {
      await CashCollectionAudit.create({
        businessId: updated.businessId,
        businessName: updated.businessName,
        weekKey: updated.weekKey,
        cashCollectionId: updated._id,
        actor: {
          type: "admin",
          id: "admin_key",
          label: "admin",
        },
        action: actionToAudit(action),
        before: buildAuditSnapshot(before),
        after: buildAuditSnapshot(updated),
        note: note || null,
        meta: {
          enforcedProof: proofIsRequired,
          missingFields: proof.missingFields,
        },
      });
    } catch {
      // Best effort audit write.
    }

    return ok({
      cashCollection: {
        id: String(updated._id),
        businessId: String(updated.businessId),
        businessName: updated.businessName,
        weekKey: updated.weekKey,
        status: updated.status,
        expected: updated.expected || {
          ordersCount: 0,
          grossSubtotal: 0,
          promoDiscountTotal: 0,
          netSubtotal: 0,
          commissionTotal: 0,
        },
        reported: updated.reported || null,
        discrepancy: updated.discrepancy || { cashDiff: 0, ordersDiff: 0 },
        notes: updated.notes || null,
        integrity: {
          expectedHash: String(updated.integrity?.expectedHash || ""),
          computedAt: updated.integrity?.computedAt || null,
          status: updated.integrity?.status || "ok",
        },
        proofComplete: updatedProof.proofComplete,
        missingProofFields: updatedProof.missingFields,
        submittedAt: updated.submittedAt || null,
        verifiedAt: updated.verifiedAt || null,
        updatedAt: updated.updatedAt || null,
      },
    });
  } catch (error: unknown) {
    const err = error as ApiError;
    return fail(
      err.code || "SERVER_ERROR",
      err.message || "Could not update cash collection status.",
      err.status || 500
    );
  }
}
