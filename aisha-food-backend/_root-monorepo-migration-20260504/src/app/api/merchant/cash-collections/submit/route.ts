import mongoose from "mongoose";
import { dbConnect } from "@/lib/mongodb";
import { ok, fail, readJson } from "@/lib/apiResponse";
import { requireMerchantSession } from "@/lib/merchantAuth";
import { requireMerchantBusinessAvailable } from "@/lib/merchantBusiness";
import { roundCurrency } from "@/lib/money";
import { upsertExpectedCashCollectionsForWeek } from "@/lib/cashCollectionCompute";
import { normalizeCollectionMethod } from "@/lib/cashCollectionProof";
import { CashCollection } from "@/models/CashCollection";
import { CashCollectionAudit } from "@/models/CashCollectionAudit";

type ApiError = Error & { status?: number; code?: string };

type Body = {
  weekKey?: string;
  cashCollected?: number;
  ordersCount?: number;
  receiptRef?: string;
  receiptPhotoUrl?: string;
  collectorName?: string;
  collectionMethod?: "in_person" | "bank_deposit" | "bank_transfer" | "transfer" | "pickup" | "other";
  note?: string;
  confirm?: string;
};

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
  driverCash?: {
    driverCollectedTotalRdp?: number;
    driverHandedTotalRdp?: number;
    driverDisputedTotalRdp?: number;
    merchantCashReceivedTotalRdp?: number;
    mismatchSignal?: boolean;
  } | null;
};

function toFiniteNumber(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

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

export async function POST(req: Request) {
  try {
    const session = requireMerchantSession(req);
    const body = await readJson<Body>(req);
    const weekKey = String(body.weekKey || "").trim();
    const confirm = String(body.confirm || "").trim();
    const collectorName = String(body.collectorName || "").trim();
    const receiptRef = String(body.receiptRef || "").trim();
    const receiptPhotoUrl = String(body.receiptPhotoUrl || "").trim();
    const note = String(body.note || "").trim();
    const collectionMethod = String(body.collectionMethod || "").trim();
    const cashCollectedRaw = toFiniteNumber(body.cashCollected);
    const ordersCountRaw = toFiniteNumber(body.ordersCount);

    if (!weekKey) return fail("VALIDATION_ERROR", "weekKey is required.", 400);
    if (confirm !== "SUBMIT") {
      return fail("VALIDATION_ERROR", 'confirm must equal "SUBMIT".', 400);
    }
    if (cashCollectedRaw == null || cashCollectedRaw < 0 || cashCollectedRaw >= 10000000) {
      return fail("VALIDATION_ERROR", "Invalid cashCollected.", 400);
    }
    if (ordersCountRaw == null || ordersCountRaw < 0 || ordersCountRaw > 100000) {
      return fail("VALIDATION_ERROR", "Invalid ordersCount.", 400);
    }
    if (collectorName.length > 60) {
      return fail("VALIDATION_ERROR", "collectorName must be 60 characters or less.", 400);
    }
    if (receiptRef.length > 80) {
      return fail("VALIDATION_ERROR", "receiptRef must be 80 characters or less.", 400);
    }
    if (receiptPhotoUrl.length > 500) {
      return fail("VALIDATION_ERROR", "receiptPhotoUrl must be 500 characters or less.", 400);
    }
    if (note.length > 500) {
      return fail("VALIDATION_ERROR", "note must be 500 characters or less.", 400);
    }
    const normalizedMethod = normalizeCollectionMethod(collectionMethod);
    if (collectionMethod && !normalizedMethod) {
      return fail("VALIDATION_ERROR", "Invalid collectionMethod.", 400);
    }

    await dbConnect();
    await requireMerchantBusinessAvailable(session.businessId);
    const businessObjectId = new mongoose.Types.ObjectId(session.businessId);

    let existing = await CashCollection.findOne({
      businessId: businessObjectId,
      weekKey,
    }).lean<CashCollectionLean | null>();

    if (!existing) {
      await upsertExpectedCashCollectionsForWeek({
        weekKey,
        businessIds: [businessObjectId],
      });
      existing = await CashCollection.findOne({
        businessId: businessObjectId,
        weekKey,
      }).lean<CashCollectionLean | null>();
    }

    if (!existing) {
      return fail("SERVER_ERROR", "Could not initialize cash collection sheet.", 500);
    }

    if (!["open", "disputed"].includes(existing.status)) {
      return fail(
        "INVALID_STATE",
        "Cash collection can only be submitted from open or disputed state.",
        409
      );
    }

    const cashCollected = roundCurrency(cashCollectedRaw);
    const ordersCount = Math.round(ordersCountRaw);
    const commissionTotal = roundCurrency(Number(existing.expected.commissionTotal || 0));
    const netSubtotal = cashCollected;
    const grossSubtotal = roundCurrency(netSubtotal + commissionTotal);
    const cashDiff = roundCurrency(cashCollected - roundCurrency(Number(existing.expected.netSubtotal || 0)));
    const ordersDiff = Math.round(ordersCount - Math.round(Number(existing.expected.ordersCount || 0)));
    const driverHandedTotalRdp = roundCurrency(Number(existing.driverCash?.driverHandedTotalRdp || 0));
    const mismatchSignal = cashCollected < driverHandedTotalRdp;
    const now = new Date();

    const updated = await CashCollection.findOneAndUpdate(
      {
        businessId: businessObjectId,
        weekKey,
        status: { $in: ["open", "disputed"] },
      },
      {
        $set: {
          status: "submitted",
          reported: {
            cashCollected,
            grossSubtotal,
            netSubtotal,
            commissionTotal,
            ordersCount,
            collectorName: collectorName || null,
            collectionMethod: normalizedMethod,
            receiptPhotoUrl: receiptPhotoUrl || null,
            receiptRef: receiptRef || null,
            reportedAt: now,
          },
          discrepancy: {
            cashDiff,
            ordersDiff,
          },
          driverCash: {
            driverCollectedTotalRdp: roundCurrency(
              Number(existing.driverCash?.driverCollectedTotalRdp || 0)
            ),
            driverHandedTotalRdp,
            driverDisputedTotalRdp: roundCurrency(
              Number(existing.driverCash?.driverDisputedTotalRdp || 0)
            ),
            merchantCashReceivedTotalRdp: cashCollected,
            mismatchSignal,
          },
          notes: note || null,
          submittedByMerchantId: businessObjectId,
          submittedAt: now,
          verifiedAt: null,
        },
      },
      { returnDocument: "after" }
    ).lean<CashCollectionLean | null>();

    if (!updated) {
      return fail("CONFLICT", "Cash collection was updated by another process. Retry.", 409);
    }

    try {
      await CashCollectionAudit.create({
        businessId: updated.businessId,
        businessName: updated.businessName,
        weekKey: updated.weekKey,
        cashCollectionId: updated._id,
        actor: {
          type: "merchant",
          id: session.businessId,
          label: "merchant",
        },
        action: "MERCHANT_SUBMITTED",
        before: buildAuditSnapshot(existing),
        after: buildAuditSnapshot(updated),
        note: note || null,
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
        expected: updated.expected,
        reported: updated.reported || null,
        discrepancy: updated.discrepancy || { cashDiff: 0, ordersDiff: 0 },
        notes: note || null,
        updatedAt: now.toISOString(),
      },
    });
  } catch (error: unknown) {
    const err = error as ApiError;
    return fail(
      err.code || "SERVER_ERROR",
      err.message || "Could not submit cash collection.",
      err.status || 500
    );
  }
}
