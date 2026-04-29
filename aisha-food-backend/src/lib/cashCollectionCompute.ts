import mongoose from "mongoose";
import { dbConnect } from "@/lib/mongodb";
import { roundCurrency } from "@/lib/money";
import { computeExpectedHash } from "@/lib/integrityHash";
import { Business } from "@/models/Business";
import { Order } from "@/models/Order";
import { CashCollection } from "@/models/CashCollection";
import { CashCollectionAudit } from "@/models/CashCollectionAudit";
import { DriverCashHandoff } from "@/models/DriverCashHandoff";

export type CashCollectionExpected = {
  ordersCount: number;
  grossSubtotal: number;
  promoDiscountTotal: number;
  netSubtotal: number;
  commissionTotal: number;
};

type OrderAggregateRow = {
  _id: mongoose.Types.ObjectId;
  ordersCount: number;
  grossSubtotal: number;
  promoDiscountTotal: number;
  netSubtotal: number;
  commissionTotal: number;
};

type BusinessLean = {
  _id: mongoose.Types.ObjectId;
  name: string;
};

type ExistingCashCollectionLean = {
  _id: mongoose.Types.ObjectId;
  businessId: mongoose.Types.ObjectId;
  businessName: string;
  status: "open" | "submitted" | "verified" | "disputed" | "closed";
  reported?: {
    cashCollected?: number | null;
    grossSubtotal?: number | null;
    netSubtotal?: number | null;
    commissionTotal?: number | null;
    ordersCount?: number | null;
    collectorName?: string | null;
    collectionMethod?:
      | "in_person"
      | "bank_deposit"
      | "bank_transfer"
      | "transfer"
      | "pickup"
      | "other"
      | null;
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

type DriverCashAggregateRow = {
  _id: mongoose.Types.ObjectId;
  driverCollectedTotalRdp: number;
  driverHandedTotalRdp: number;
  driverDisputedTotalRdp: number;
};

type BulkResultLike = {
  modifiedCount?: number;
  upsertedCount?: number;
  nModified?: number;
  nUpserted?: number;
};

function safeNumber(value: unknown) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeExpected(row?: Partial<OrderAggregateRow>): CashCollectionExpected {
  return {
    ordersCount: Math.max(0, Math.round(safeNumber(row?.ordersCount))),
    grossSubtotal: roundCurrency(safeNumber(row?.grossSubtotal)),
    promoDiscountTotal: roundCurrency(safeNumber(row?.promoDiscountTotal)),
    netSubtotal: roundCurrency(safeNumber(row?.netSubtotal)),
    commissionTotal: roundCurrency(safeNumber(row?.commissionTotal)),
  };
}

function normalizeDriverCash(row?: Partial<DriverCashAggregateRow>) {
  return {
    driverCollectedTotalRdp: roundCurrency(safeNumber(row?.driverCollectedTotalRdp)),
    driverHandedTotalRdp: roundCurrency(safeNumber(row?.driverHandedTotalRdp)),
    driverDisputedTotalRdp: roundCurrency(safeNumber(row?.driverDisputedTotalRdp)),
  };
}

export async function computeExpectedForWeek(businessId: string, weekKey: string) {
  await dbConnect();
  const objectBusinessId = new mongoose.Types.ObjectId(businessId);
  const aggregate = await Order.aggregate<OrderAggregateRow>([
    {
      $match: {
        businessId: objectBusinessId,
        status: "delivered",
        "settlement.counted": true,
        "settlement.weekKey": weekKey,
      },
    },
    {
      $group: {
        _id: "$businessId",
        ordersCount: { $sum: 1 },
        grossSubtotal: { $sum: { $ifNull: ["$subtotal", 0] } },
        promoDiscountTotal: {
          $sum: {
            $cond: [
              { $eq: ["$discount.source", "promo"] },
              { $ifNull: ["$discount.amount", 0] },
              0,
            ],
          },
        },
        netSubtotal: { $sum: { $ifNull: ["$total", 0] } },
        commissionTotal: { $sum: { $ifNull: ["$commissionAmount", 0] } },
      },
    },
  ]);

  const expected = normalizeExpected(aggregate[0]);
  const expectedHash = computeExpectedHash({
    businessId,
    weekKey,
    expected,
  });
  return {
    expected,
    expectedHash,
  };
}

function buildAuditSnapshot(input: {
  status: string;
  reported?: ExistingCashCollectionLean["reported"];
  discrepancy?: ExistingCashCollectionLean["discrepancy"];
}) {
  return {
    status: String(input.status || "").trim(),
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
      cashDiff: roundCurrency(safeNumber(input.discrepancy?.cashDiff)),
      ordersDiff: Math.round(safeNumber(input.discrepancy?.ordersDiff)),
    },
  };
}

export async function upsertExpectedCashCollectionsForWeek(args: {
  weekKey: string;
  businessIds?: mongoose.Types.ObjectId[];
}) {
  await dbConnect();
  const weekKey = String(args.weekKey || "").trim();

  const businessFilter: Record<string, unknown> =
    Array.isArray(args.businessIds) && args.businessIds.length > 0
      ? { _id: { $in: args.businessIds } }
      : {
          isActive: true,
          isDemo: { $ne: true },
        };

  const businesses = await Business.find(businessFilter)
    .select("_id name")
    .lean<BusinessLean[]>();

  if (!businesses.length) {
    return {
      weekKey,
      scanned: 0,
      createdCount: 0,
      updatedCount: 0,
    };
  }

  const businessIds = businesses.map((row) => row._id);
  const [aggregateRows, driverCashRows, existingRows] = await Promise.all([
    Order.aggregate<OrderAggregateRow>([
      {
        $match: {
          businessId: { $in: businessIds },
          status: "delivered",
          "settlement.counted": true,
          "settlement.weekKey": weekKey,
        },
      },
      {
        $group: {
          _id: "$businessId",
          ordersCount: { $sum: 1 },
          grossSubtotal: { $sum: { $ifNull: ["$subtotal", 0] } },
          promoDiscountTotal: {
            $sum: {
              $cond: [
                { $eq: ["$discount.source", "promo"] },
                { $ifNull: ["$discount.amount", 0] },
                0,
              ],
            },
          },
          netSubtotal: { $sum: { $ifNull: ["$total", 0] } },
          commissionTotal: { $sum: { $ifNull: ["$commissionAmount", 0] } },
        },
      },
    ]),
    DriverCashHandoff.aggregate<DriverCashAggregateRow>([
      {
        $match: {
          businessId: { $in: businessIds },
          weekKey,
        },
      },
      {
        $group: {
          _id: "$businessId",
          driverCollectedTotalRdp: {
            $sum: {
              $cond: [{ $ne: ["$status", "void"] }, { $ifNull: ["$amountCollectedRdp", 0] }, 0],
            },
          },
          driverHandedTotalRdp: {
            $sum: {
              $cond: [{ $eq: ["$status", "handed_to_merchant"] }, { $ifNull: ["$amountCollectedRdp", 0] }, 0],
            },
          },
          driverDisputedTotalRdp: {
            $sum: {
              $cond: [{ $eq: ["$status", "disputed"] }, { $ifNull: ["$amountCollectedRdp", 0] }, 0],
            },
          },
        },
      },
    ]),
    CashCollection.find({
      weekKey,
      businessId: { $in: businessIds },
    })
      .select("_id businessId businessName status reported discrepancy driverCash")
      .lean<ExistingCashCollectionLean[]>(),
  ]);

  const aggregateByBusiness = new Map<string, CashCollectionExpected>();
  for (const row of aggregateRows) {
    aggregateByBusiness.set(String(row._id), normalizeExpected(row));
  }
  const driverCashByBusiness = new Map<string, ReturnType<typeof normalizeDriverCash>>();
  for (const row of driverCashRows) {
    driverCashByBusiness.set(String(row._id), normalizeDriverCash(row));
  }

  const existingByBusiness = new Map<string, ExistingCashCollectionLean>();
  for (const row of existingRows) {
    existingByBusiness.set(String(row.businessId), row);
  }

  const now = new Date();
  const bulkOps = businesses.map((business) => {
    const businessId = business._id;
    const businessKey = String(businessId);
    const expected = aggregateByBusiness.get(businessKey) || normalizeExpected();
    const driverCash = driverCashByBusiness.get(businessKey) || normalizeDriverCash();
    const merchantCashReceivedTotalRdp = roundCurrency(
      safeNumber(existingByBusiness.get(businessKey)?.reported?.cashCollected)
    );
    const mismatchSignal = merchantCashReceivedTotalRdp < Number(driverCash.driverHandedTotalRdp || 0);
    const expectedHash = computeExpectedHash({
      businessId: businessKey,
      weekKey,
      expected,
    });

    return {
      updateOne: {
        filter: { businessId, weekKey },
        update: {
          $set: {
            businessName: String(business.name || ""),
            expected,
            integrity: {
              expectedHash,
              computedAt: now,
              status: "ok",
            },
            driverCash: {
              ...driverCash,
              merchantCashReceivedTotalRdp,
              mismatchSignal,
            },
            updatedAt: now,
          },
          $setOnInsert: {
            status: "open",
            reported: {
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
            },
            discrepancy: {
              cashDiff: 0,
              ordersDiff: 0,
            },
            notes: null,
            submittedByMerchantId: null,
            submittedAt: null,
            verifiedAt: null,
            createdAt: now,
          },
        },
        upsert: true,
      },
    };
  });

  const bulkWriteResult = await CashCollection.bulkWrite(bulkOps, { ordered: false });
  const resultLike = bulkWriteResult as unknown as BulkResultLike;
  const createdCount = Math.max(
    0,
    Math.round(safeNumber(resultLike.upsertedCount ?? resultLike.nUpserted))
  );
  const updatedCount = Math.max(
    0,
    Math.round(safeNumber(resultLike.modifiedCount ?? resultLike.nModified))
  );

  const latestRows = await CashCollection.find({
    weekKey,
    businessId: { $in: businessIds },
  })
    .select("_id businessId businessName status reported discrepancy")
    .lean<ExistingCashCollectionLean[]>();
  const latestByBusiness = new Map<string, ExistingCashCollectionLean>();
  for (const row of latestRows) {
    latestByBusiness.set(String(row.businessId), row);
  }

  const audits = businesses
    .map((business) => {
      const businessKey = String(business._id);
      const before = existingByBusiness.get(businessKey);
      const after = latestByBusiness.get(businessKey);
      if (!after) return null;
      return {
        businessId: business._id,
        businessName: String(after.businessName || business.name || ""),
        weekKey,
        cashCollectionId: after._id,
        actor: {
          type: "system" as const,
          id: "cash-collections-compute",
          label: "system",
        },
        action: "EXPECTED_COMPUTED" as const,
        before: before
          ? buildAuditSnapshot({
              status: before.status,
              reported: before.reported || undefined,
              discrepancy: before.discrepancy || undefined,
            })
          : null,
        after: buildAuditSnapshot({
          status: after.status,
          reported: after.reported || undefined,
          discrepancy: after.discrepancy || undefined,
        }),
        note: null,
        createdAt: now,
        updatedAt: now,
      };
    })
    .filter((row): row is NonNullable<typeof row> => Boolean(row));

  if (audits.length) {
    await CashCollectionAudit.insertMany(audits, { ordered: false });
  }

  return {
    weekKey,
    scanned: businesses.length,
    createdCount,
    updatedCount,
  };
}
