import mongoose from "mongoose";
import { roundCurrency } from "@/lib/money";
import { normalizePayoutMethod } from "@/lib/merchantOnboarding";
import { Business } from "@/models/Business";
import { Order } from "@/models/Order";
import { RestaurantSettlement } from "@/models/RestaurantSettlement";

type SettlementDateBounds = {
  settlementDate: string;
  periodStart: Date;
  periodEnd: Date;
};

type SettlementOrderRow = {
  _id: mongoose.Types.ObjectId;
  businessId: mongoose.Types.ObjectId;
  orderTotal?: number | null;
  platformCommissionAmount?: number | null;
  restaurantNetAmount?: number | null;
  deliveryFeeToCustomer?: number | null;
  paymentMethod?: string | null;
  paymentStatus?: string | null;
  payment?: {
    method?: string | null;
    status?: string | null;
  } | null;
  updatedAt?: Date | null;
  currency?: string | null;
  settlement?: {
    counted?: boolean;
  } | null;
};

type BusinessPayoutRow = {
  _id: mongoose.Types.ObjectId;
  cityId?: mongoose.Types.ObjectId | null;
  name?: string | null;
  payout?: {
    preferredMethod?: string | null;
    payoutContactName?: string | null;
    details?: string | null;
    accountName?: string | null;
    accountNumber?: string | null;
    notes?: string | null;
  } | null;
};

const DATE_KEY_REGEX = /^\d{4}-\d{2}-\d{2}$/;

function safeNumber(value: unknown) {
  const numeric = Number(value || 0);
  return Number.isFinite(numeric) ? numeric : 0;
}

export function normalizeSettlementDate(value?: string | null) {
  const trimmed = String(value || "").trim();
  if (DATE_KEY_REGEX.test(trimmed)) return trimmed;
  return new Date().toISOString().slice(0, 10);
}

export function getSettlementDateBounds(value?: string | null): SettlementDateBounds {
  const settlementDate = normalizeSettlementDate(value);
  const periodStart = new Date(`${settlementDate}T00:00:00.000Z`);
  const periodEnd = new Date(`${settlementDate}T23:59:59.999Z`);
  return { settlementDate, periodStart, periodEnd };
}

function isEligibleOrder(order: SettlementOrderRow) {
  if (!order || String(order.paymentStatus || order.payment?.status || "").trim() === "failed") {
    return false;
  }
  if (!order.settlement?.counted) return false;

  const method = String(order.paymentMethod || order.payment?.method || "").trim().toLowerCase();
  const status = String(order.paymentStatus || order.payment?.status || "").trim().toLowerCase();
  if (method === "paytech") {
    return status === "paid";
  }
  if (status === "cancelled" || status === "failed" || status === "pending") {
    return false;
  }
  return true;
}

function mapBusinessPayout(business: BusinessPayoutRow | null) {
  const payout = business?.payout || null;
  return {
    payoutMethod: normalizePayoutMethod(payout?.preferredMethod),
    payoutAccountName: String(
      payout?.accountName || payout?.payoutContactName || ""
    ).trim(),
    payoutAccountNumber: String(payout?.accountNumber || "").trim(),
    payoutNotes: String(payout?.notes || payout?.details || "").trim(),
  };
}

function summarizeOrders(orders: SettlementOrderRow[]) {
  return {
    grossSales: roundCurrency(orders.reduce((sum, order) => sum + safeNumber(order.orderTotal), 0)),
    platformCommission: roundCurrency(
      orders.reduce((sum, order) => sum + safeNumber(order.platformCommissionAmount), 0)
    ),
    deliveryFeesCollected: roundCurrency(
      orders.reduce((sum, order) => sum + safeNumber(order.deliveryFeeToCustomer), 0)
    ),
    restaurantNet: roundCurrency(
      orders.reduce((sum, order) => sum + safeNumber(order.restaurantNetAmount), 0)
    ),
    orderCount: orders.length,
    paidOrderIds: orders.map((order) => order._id),
    currency: String(orders[0]?.currency || "XOF").trim() || "XOF",
  };
}

export async function syncRestaurantSettlementsForDate(dateKey?: string | null) {
  const { settlementDate, periodStart, periodEnd } = getSettlementDateBounds(dateKey);

  const existing = await RestaurantSettlement.find({
    settlementDate,
    archivedAt: null,
  })
    .select(
      "_id cityId merchantId restaurantName settlementDate status paidOrderIds payoutMethod payoutAccountName payoutAccountNumber payoutNotes grossSales platformCommission deliveryFeesCollected restaurantNet orderCount currency"
    )
    .lean<
      Array<{
        _id: mongoose.Types.ObjectId;
        cityId?: mongoose.Types.ObjectId | null;
        merchantId: mongoose.Types.ObjectId;
        restaurantName?: string;
        settlementDate: string;
        status: "pending" | "paid" | "failed" | "cancelled";
        paidOrderIds?: mongoose.Types.ObjectId[];
        payoutMethod?: string;
        payoutAccountName?: string;
        payoutAccountNumber?: string;
        payoutNotes?: string;
        grossSales?: number;
        platformCommission?: number;
        deliveryFeesCollected?: number;
        restaurantNet?: number;
        orderCount?: number;
        currency?: string;
      }>
    >();

  const existingByMerchantId = new Map(existing.map((row) => [String(row.merchantId), row]));
  const settledOrderIds = new Set<string>();
  for (const row of existing) {
    for (const orderId of row.paidOrderIds || []) {
      settledOrderIds.add(String(orderId));
    }
  }

  const orders = await Order.find({
    status: "delivered",
    "settlement.counted": true,
    updatedAt: { $gte: periodStart, $lte: periodEnd },
    businessId: { $exists: true, $ne: null },
  })
    .select(
      "_id businessId orderTotal platformCommissionAmount restaurantNetAmount deliveryFeeToCustomer paymentMethod paymentStatus payment.method payment.status updatedAt currency settlement.counted"
    )
    .lean<SettlementOrderRow[]>();

  const eligible = orders.filter(
    (order) => !settledOrderIds.has(String(order._id)) && isEligibleOrder(order)
  );

  if (!eligible.length) {
    return RestaurantSettlement.find({
      settlementDate,
      archivedAt: null,
    })
      .sort({ restaurantName: 1 })
      .lean();
  }

  const grouped = new Map<string, SettlementOrderRow[]>();
  for (const order of eligible) {
    const key = String(order.businessId || "");
    if (!key) continue;
    const current = grouped.get(key) || [];
    current.push(order);
    grouped.set(key, current);
  }

  const businessIds = Array.from(grouped.keys())
    .filter((value) => mongoose.Types.ObjectId.isValid(value))
    .map((value) => new mongoose.Types.ObjectId(value));

  const businesses = await Business.find({ _id: { $in: businessIds } })
    .select("_id cityId name payout")
    .lean<BusinessPayoutRow[]>();
  const businessById = new Map(businesses.map((row) => [String(row._id), row]));

  for (const [merchantId, merchantOrders] of grouped.entries()) {
    const business = businessById.get(merchantId);
    if (!business) continue;

    const summary = summarizeOrders(merchantOrders);
    const payout = mapBusinessPayout(business);
    const existingRow = existingByMerchantId.get(merchantId);

    if (!existingRow) {
      await RestaurantSettlement.create({
        cityId: business.cityId || null,
        merchantId: business._id,
        restaurantName: String(business.name || "Restaurant").trim() || "Restaurant",
        settlementDate,
        periodStart,
        periodEnd,
        currency: summary.currency,
        grossSales: summary.grossSales,
        platformCommission: summary.platformCommission,
        deliveryFeesCollected: summary.deliveryFeesCollected,
        restaurantNet: summary.restaurantNet,
        orderCount: summary.orderCount,
        paidOrderIds: summary.paidOrderIds,
        payoutMethod: payout.payoutMethod,
        payoutAccountName: payout.payoutAccountName,
        payoutAccountNumber: payout.payoutAccountNumber,
        payoutNotes: payout.payoutNotes,
        status: "pending",
      });
      continue;
    }

    if (existingRow.status === "paid") {
      continue;
    }

    await RestaurantSettlement.updateOne(
      { _id: existingRow._id },
      {
        $set: {
          cityId: business.cityId || null,
          restaurantName: String(business.name || existingRow.restaurantName || "Restaurant").trim(),
          payoutMethod: payout.payoutMethod,
          payoutAccountName: payout.payoutAccountName,
          payoutAccountNumber: payout.payoutAccountNumber,
          payoutNotes: payout.payoutNotes,
          currency: summary.currency || existingRow.currency || "XOF",
        },
        $addToSet: { paidOrderIds: { $each: summary.paidOrderIds } },
        $inc: {
          grossSales: summary.grossSales,
          platformCommission: summary.platformCommission,
          deliveryFeesCollected: summary.deliveryFeesCollected,
          restaurantNet: summary.restaurantNet,
          orderCount: summary.orderCount,
        },
      }
    );
  }

  return RestaurantSettlement.find({
    settlementDate,
    archivedAt: null,
  })
    .sort({ restaurantName: 1 })
    .lean();
}
