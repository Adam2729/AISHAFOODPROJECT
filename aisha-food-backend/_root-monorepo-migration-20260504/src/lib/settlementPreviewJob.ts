import mongoose from "mongoose";
import { dbConnect } from "@/lib/mongodb";
import { Business } from "@/models/Business";
import { Order } from "@/models/Order";
import { Settlement } from "@/models/Settlement";
import { SettlementPreview } from "@/models/SettlementPreview";
import { settlementHashV1 } from "@/lib/integrity";

type BusinessLean = {
  _id: mongoose.Types.ObjectId;
  name: string;
};

type OrderAggregateRow = {
  _id: mongoose.Types.ObjectId;
  expectedOrdersCount: number;
  expectedGrossSubtotal: number;
  expectedFeeTotal: number;
};

type SettlementLean = {
  businessId: mongoose.Types.ObjectId;
  ordersCount?: number;
  grossSubtotal?: number;
  feeTotal?: number;
  weekKey: string;
  integrityHash?: string;
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

export async function generateSettlementPreviewsForWeek(weekKey: string): Promise<{
  weekKey: string;
  totalBusinesses: number;
  previewsUpserted: number;
  mismatches: number;
  generatedAt: string;
}> {
  await dbConnect();

  const generatedAt = new Date();
  const activeBusinesses = await Business.find({
    isActive: true,
    isDemo: { $ne: true },
  })
    .select("_id name")
    .lean<BusinessLean[]>();

  if (!activeBusinesses.length) {
    return {
      weekKey,
      totalBusinesses: 0,
      previewsUpserted: 0,
      mismatches: 0,
      generatedAt: generatedAt.toISOString(),
    };
  }

  const businessIds = activeBusinesses.map((business) => business._id);

  const [expectedRows, storedSettlements] = await Promise.all([
    Order.aggregate<OrderAggregateRow>([
      {
        $match: {
          status: "delivered",
          "settlement.weekKey": weekKey,
          "settlement.counted": true,
          businessId: { $in: businessIds },
        },
      },
      {
        $group: {
          _id: "$businessId",
          expectedOrdersCount: { $sum: 1 },
          expectedGrossSubtotal: { $sum: { $ifNull: ["$subtotal", 0] } },
          expectedFeeTotal: { $sum: { $ifNull: ["$commissionAmount", 0] } },
        },
      },
    ]),
    Settlement.find({
      weekKey,
      businessId: { $in: businessIds },
    })
      .select("businessId weekKey ordersCount grossSubtotal feeTotal integrityHash")
      .lean<SettlementLean[]>(),
  ]);

  const expectedByBusiness = new Map<string, Omit<OrderAggregateRow, "_id">>();
  for (const row of expectedRows) {
    expectedByBusiness.set(String(row._id), {
      expectedOrdersCount: safeNumber(row.expectedOrdersCount),
      expectedGrossSubtotal: safeNumber(row.expectedGrossSubtotal),
      expectedFeeTotal: safeNumber(row.expectedFeeTotal),
    });
  }

  const storedByBusiness = new Map<string, SettlementLean>();
  for (const settlement of storedSettlements) {
    storedByBusiness.set(String(settlement.businessId), settlement);
  }

  let mismatches = 0;
  const bulkOps = activeBusinesses.map((business) => {
    const businessId = business._id;
    const businessKey = String(businessId);
    const expected = expectedByBusiness.get(businessKey) || {
      expectedOrdersCount: 0,
      expectedGrossSubtotal: 0,
      expectedFeeTotal: 0,
    };
    const stored = storedByBusiness.get(businessKey);
    const storedExists = Boolean(stored);

    const storedOrdersCount = storedExists ? safeNumber(stored?.ordersCount) : null;
    const storedGrossSubtotal = storedExists ? safeNumber(stored?.grossSubtotal) : null;
    const storedFeeTotal = storedExists ? safeNumber(stored?.feeTotal) : null;
    const storedIntegrityHash = storedExists ? String(stored?.integrityHash || "").trim() : "";
    const integrityHasHash = Boolean(storedIntegrityHash);
    const recalculatedIntegrityHash = storedExists
      ? settlementHashV1({
          businessId: String(businessId),
          weekKey,
          ordersCount: safeNumber(stored?.ordersCount),
          grossSubtotal: safeNumber(stored?.grossSubtotal),
          feeTotal: safeNumber(stored?.feeTotal),
        })
      : null;
    const integrityHashMatches = storedExists
      ? (integrityHasHash ? storedIntegrityHash === recalculatedIntegrityHash : null)
      : null;

    const diffOrdersCount = storedExists ? expected.expectedOrdersCount - safeNumber(storedOrdersCount) : null;
    const diffGrossSubtotal = storedExists ? expected.expectedGrossSubtotal - safeNumber(storedGrossSubtotal) : null;
    const diffFeeTotal = storedExists ? expected.expectedFeeTotal - safeNumber(storedFeeTotal) : null;

    const mismatch = storedExists
      ? diffOrdersCount !== 0 || diffGrossSubtotal !== 0 || diffFeeTotal !== 0
      : expected.expectedOrdersCount > 0;
    if (mismatch) mismatches += 1;

    return {
      updateOne: {
        filter: { businessId, weekKey },
        update: {
          $set: {
            businessId,
            businessName: business.name,
            weekKey,
            expectedOrdersCount: expected.expectedOrdersCount,
            expectedGrossSubtotal: expected.expectedGrossSubtotal,
            expectedFeeTotal: expected.expectedFeeTotal,
            storedExists,
            storedOrdersCount,
            storedGrossSubtotal,
            storedFeeTotal,
            integrityHasHash,
            integrityHashMatches,
            diffOrdersCount,
            diffGrossSubtotal,
            diffFeeTotal,
            mismatch,
            generatedAt,
          },
        },
        upsert: true,
      },
    };
  });

  const bulkResult = await SettlementPreview.bulkWrite(bulkOps, { ordered: false });
  const resultLike = bulkResult as unknown as BulkResultLike;
  const previewsUpserted = safeNumber(resultLike.modifiedCount ?? resultLike.nModified) +
    safeNumber(resultLike.upsertedCount ?? resultLike.nUpserted);

  return {
    weekKey,
    totalBusinesses: activeBusinesses.length,
    previewsUpserted,
    mismatches,
    generatedAt: generatedAt.toISOString(),
  };
}
