import mongoose from "mongoose";
import { dbConnect } from "@/lib/mongodb";
import { roundCurrency } from "@/lib/money";
import { statusLabelEs } from "@/lib/orderStatusView";
import { Order } from "@/models/Order";
import { Settlement } from "@/models/Settlement";
import { CashCollection } from "@/models/CashCollection";
import { Business } from "@/models/Business";

type OrderRow = {
  _id: mongoose.Types.ObjectId;
  orderNumber?: string;
  currency?: "DOP" | "CFA" | null;
  createdAt?: Date;
  updatedAt?: Date;
  status?: string;
  subtotal?: number;
  total?: number;
  commissionAmount?: number;
  discount?: {
    source?: string | null;
    amount?: number;
  } | null;
  sla?: {
    deliveredAt?: Date | null;
  } | null;
};

type SettlementRow = {
  businessId: mongoose.Types.ObjectId;
  businessName?: string;
  weekKey: string;
  status?: "pending" | "collected" | "locked";
  grossSubtotal?: number;
  feeTotal?: number;
  ordersCount?: number;
  collectedAt?: Date | null;
  receiptRef?: string;
  collectorName?: string;
  collectionMethod?: "cash" | "transfer" | "other";
  receiptPhotoUrl?: string;
  lockedAt?: Date | null;
  lockedBy?: string | null;
  resolutionStatus?: "confirmed_correct" | "adjusted" | "merchant_disputed" | "writeoff" | null;
  resolutionNote?: string | null;
  resolutionAttachmentUrl?: string | null;
  resolvedAt?: Date | null;
  resolvedBy?: string | null;
  integrityHash?: string | null;
};

type CashCollectionRow = {
  businessId: mongoose.Types.ObjectId;
  businessName?: string;
  weekKey: string;
  status?: "open" | "submitted" | "verified" | "disputed" | "closed";
  expected?: {
    netSubtotal?: number;
  } | null;
  reported?: {
    cashCollected?: number | null;
    collectorName?: string | null;
    collectionMethod?: "in_person" | "bank_deposit" | "bank_transfer" | "transfer" | "pickup" | "other" | null;
    receiptPhotoUrl?: string | null;
    receiptRef?: string | null;
    reportedAt?: Date | null;
  } | null;
  integrity?: {
    expectedHash?: string;
  } | null;
  submittedAt?: Date | null;
  verifiedAt?: Date | null;
};

type BusinessRow = {
  _id: mongoose.Types.ObjectId;
  name?: string;
};

function safeNumber(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function safeDateIso(value: unknown) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function normalizeMethod(
  value: unknown
): "in_person" | "bank_deposit" | "bank_transfer" | "transfer" | "pickup" | "other" | null {
  const normalized = String(value || "").trim().toLowerCase();
  if (
    normalized === "in_person" ||
    normalized === "bank_deposit" ||
    normalized === "bank_transfer" ||
    normalized === "transfer" ||
    normalized === "pickup" ||
    normalized === "other"
  ) {
    return normalized;
  }
  return null;
}

export async function computeWeeklyStatementPack(businessId: string, weekKey: string) {
  const normalizedBusinessId = String(businessId || "").trim();
  const normalizedWeekKey = String(weekKey || "").trim();
  if (!mongoose.Types.ObjectId.isValid(normalizedBusinessId)) {
    throw new Error("Invalid businessId.");
  }
  if (!normalizedWeekKey) {
    throw new Error("weekKey is required.");
  }

  await dbConnect();
  const businessObjectId = new mongoose.Types.ObjectId(normalizedBusinessId);

  const [orders, settlement, cashCollection, business] = await Promise.all([
    Order.find({
      businessId: businessObjectId,
      status: "delivered",
      "settlement.counted": true,
      "settlement.weekKey": normalizedWeekKey,
    })
      .select("_id orderNumber currency createdAt updatedAt status subtotal total commissionAmount discount sla.deliveredAt")
      .sort({ createdAt: 1 })
      .lean<OrderRow[]>(),
    Settlement.findOne({
      businessId: businessObjectId,
      weekKey: normalizedWeekKey,
    })
      .select(
        "businessId businessName weekKey status grossSubtotal feeTotal ordersCount collectedAt receiptRef collectorName collectionMethod receiptPhotoUrl lockedAt lockedBy resolutionStatus resolutionNote resolutionAttachmentUrl resolvedAt resolvedBy integrityHash"
      )
      .lean<SettlementRow | null>(),
    CashCollection.findOne({
      businessId: businessObjectId,
      weekKey: normalizedWeekKey,
    })
      .select(
        "businessId businessName weekKey status expected.netSubtotal reported.cashCollected reported.collectorName reported.collectionMethod reported.receiptPhotoUrl reported.receiptRef reported.reportedAt integrity.expectedHash submittedAt verifiedAt"
      )
      .lean<CashCollectionRow | null>(),
    Business.findById(businessObjectId).select("_id name").lean<BusinessRow | null>(),
  ]);

  const mappedOrders = orders.map((row) => {
    const subtotal = roundCurrency(safeNumber(row.subtotal));
    const discountAmount = roundCurrency(
      row.discount?.source === "promo" ? safeNumber(row.discount?.amount) : 0
    );
    const netSubtotal = roundCurrency(
      row.total != null ? safeNumber(row.total) : subtotal - discountAmount
    );
    const commissionAmount = roundCurrency(safeNumber(row.commissionAmount));
    return {
      orderId: String(row._id),
      orderNumber: String(row.orderNumber || ""),
      createdAt: safeDateIso(row.createdAt),
      deliveredAt: safeDateIso(row.sla?.deliveredAt || row.updatedAt),
      subtotal,
      discount: discountAmount,
      netSubtotal,
      commissionAmount,
      statusLabelEs: statusLabelEs(
        (row.status || "delivered") as
          | "new"
          | "accepted"
          | "preparing"
          | "ready"
          | "out_for_delivery"
          | "delivered"
          | "cancelled"
      ),
    };
  });

  const promoOrdersCount = mappedOrders.filter((row) => row.discount > 0).length;
  const promoDiscountTotal = roundCurrency(
    mappedOrders.reduce((sum, row) => sum + row.discount, 0)
  );
  const grossSubtotal = roundCurrency(
    mappedOrders.reduce((sum, row) => sum + row.subtotal, 0)
  );
  const netSubtotal = roundCurrency(
    mappedOrders.reduce((sum, row) => sum + row.netSubtotal, 0)
  );
  const commissionTotal = roundCurrency(
    mappedOrders.reduce((sum, row) => sum + row.commissionAmount, 0)
  );
  const ordersCount = mappedOrders.length;

  const cashExpected = netSubtotal;
  const cashReported =
    cashCollection?.reported?.cashCollected == null
      ? null
      : roundCurrency(safeNumber(cashCollection.reported.cashCollected));
  const cashVerified =
    cashCollection && (cashCollection.status === "verified" || cashCollection.status === "closed")
      ? cashReported
      : null;
  const variance =
    cashReported == null ? 0 : roundCurrency(cashReported - cashExpected);

  const businessName =
    String(settlement?.businessName || "").trim() ||
    String(cashCollection?.businessName || "").trim() ||
    String(business?.name || "").trim() ||
    "Business";
  const currency = String(orders[0]?.currency || "").trim().toUpperCase() === "CFA" ? "CFA" : "DOP";

  return {
    businessId: normalizedBusinessId,
    businessName,
    weekKey: normalizedWeekKey,
    currency,
    settlement: {
      status: settlement?.status || "pending",
      grossSubtotal: roundCurrency(
        settlement?.grossSubtotal != null ? safeNumber(settlement.grossSubtotal) : grossSubtotal
      ),
      feeTotal: roundCurrency(
        settlement?.feeTotal != null ? safeNumber(settlement.feeTotal) : commissionTotal
      ),
      ordersCount:
        settlement?.ordersCount != null
          ? Math.max(0, Math.round(safeNumber(settlement.ordersCount)))
          : ordersCount,
      collectedAt: safeDateIso(settlement?.collectedAt),
      receiptRef: String(settlement?.receiptRef || "").trim() || null,
      receiptPhotoUrl: String(settlement?.receiptPhotoUrl || "").trim() || null,
      collectorName: String(settlement?.collectorName || "").trim() || null,
      collectionMethod: String(settlement?.collectionMethod || "").trim() || null,
      lockedAt: safeDateIso(settlement?.lockedAt),
      lockedBy: String(settlement?.lockedBy || "").trim() || null,
      resolutionStatus: settlement?.resolutionStatus || null,
      resolutionNote: String(settlement?.resolutionNote || "").trim() || null,
      resolutionAttachmentUrl: String(settlement?.resolutionAttachmentUrl || "").trim() || null,
      resolvedAt: safeDateIso(settlement?.resolvedAt),
      resolvedBy: String(settlement?.resolvedBy || "").trim() || null,
    },
    cash: {
      status: cashCollection?.status || null,
      reportedCashTotal: cashReported,
      verifiedCashTotal: cashVerified,
      expectedCashTotal:
        cashCollection?.expected?.netSubtotal != null
          ? roundCurrency(safeNumber(cashCollection.expected.netSubtotal))
          : cashExpected,
      variance,
      lastSubmittedAt: safeDateIso(
        cashCollection?.submittedAt || cashCollection?.reported?.reportedAt || null
      ),
      verifiedAt: safeDateIso(cashCollection?.verifiedAt || null),
      collectorName: String(cashCollection?.reported?.collectorName || "").trim() || null,
      collectionMethod: normalizeMethod(cashCollection?.reported?.collectionMethod),
      receiptRef: String(cashCollection?.reported?.receiptRef || "").trim() || null,
      receiptPhotoUrl: String(cashCollection?.reported?.receiptPhotoUrl || "").trim() || null,
    },
    promos: {
      promoOrdersCount,
      promoDiscountTotal,
    },
    totals: {
      ordersCount,
      grossSubtotal,
      promoDiscountTotal,
      netSubtotal,
      commissionTotal,
      cashExpected,
      cashReported,
      cashVerified,
      variance,
    },
    orders: mappedOrders,
    integrity: {
      settlementHash: String(settlement?.integrityHash || "").trim() || null,
      cashCollectionHash: String(cashCollection?.integrity?.expectedHash || "").trim() || null,
      computedAt: new Date().toISOString(),
    },
  };
}
