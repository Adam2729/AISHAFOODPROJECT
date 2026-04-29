import mongoose from "mongoose";
import { getWeekKey } from "@/lib/geo";
import { normalizeWeekKey } from "@/lib/riderPayouts";
import { RiderPayout } from "@/models/RiderPayout";
import { Order } from "@/models/Order";
import { Business } from "@/models/Business";

type PayoutRowLean = {
  _id: mongoose.Types.ObjectId;
  orderId: mongoose.Types.ObjectId;
  businessId: mongoose.Types.ObjectId;
  cityId: mongoose.Types.ObjectId;
  driverId: mongoose.Types.ObjectId;
  weekKey: string;
  amount: number;
  deliveryFeeCharged: number;
  platformMargin: number;
  status: "pending" | "paid" | "void";
  createdAt?: Date;
  paidAt?: Date | null;
};

function normalizeLimit(value: unknown, fallback = 50, max = 200) {
  const num = Number(value || fallback);
  if (!Number.isFinite(num) || num <= 0) return fallback;
  return Math.min(Math.floor(num), max);
}

function normalizeWeekKeyOrDefault(value: unknown) {
  return normalizeWeekKey(value, new Date()) || getWeekKey(new Date());
}

async function loadOrderAndBusinessMaps(orderIds: mongoose.Types.ObjectId[], businessIds: mongoose.Types.ObjectId[]) {
  const [orders, businesses] = await Promise.all([
    Order.find({ _id: { $in: orderIds } })
      .select("_id orderNumber status createdAt")
      .lean<Array<{ _id: mongoose.Types.ObjectId; orderNumber?: string; status?: string; createdAt?: Date }>>(),
    Business.find({ _id: { $in: businessIds } })
      .select("_id name")
      .lean<Array<{ _id: mongoose.Types.ObjectId; name?: string }>>(),
  ]);

  return {
    orderMap: new Map(orders.map((row) => [String(row._id), row])),
    businessMap: new Map(businesses.map((row) => [String(row._id), row])),
  };
}

export async function loadPendingPayouts(input: { cityId: mongoose.Types.ObjectId; driverId: mongoose.Types.ObjectId; weekKey?: string }) {
  const weekKey = normalizeWeekKeyOrDefault(input.weekKey);
  const payouts = await RiderPayout.find({
    cityId: input.cityId,
    driverId: input.driverId,
    status: "pending",
    weekKey,
  })
    .sort({ createdAt: -1 })
    .limit(300)
    .lean<PayoutRowLean[]>();

  const orderIds = payouts.map((row) => row.orderId);
  const businessIds = payouts.map((row) => row.businessId);
  const { orderMap, businessMap } = await loadOrderAndBusinessMaps(orderIds, businessIds);

  const rows = payouts.map((row) => {
    const order = orderMap.get(String(row.orderId));
    const business = businessMap.get(String(row.businessId));
    return {
      payoutId: String(row._id),
      orderId: String(row.orderId),
      orderNumber: String(order?.orderNumber || ""),
      businessName: String(business?.name || ""),
      amount: Number(row.amount || 0),
      deliveryFeeCharged: Number(row.deliveryFeeCharged || 0),
      platformMargin: Number(row.platformMargin || 0),
      createdAt: row.createdAt || null,
    };
  });

  const pendingAmount = rows.reduce((acc, row) => acc + Number(row.amount || 0), 0);

  return {
    weekKey,
    totals: {
      pendingCount: rows.length,
      pendingAmount,
    },
    rows,
  };
}

export async function loadPaidPayouts(input: { cityId: mongoose.Types.ObjectId; driverId: mongoose.Types.ObjectId; limit?: number }) {
  const limit = normalizeLimit(input.limit, 50, 200);
  const payouts = await RiderPayout.find({
    cityId: input.cityId,
    driverId: input.driverId,
    status: "paid",
  })
    .sort({ paidAt: -1, createdAt: -1 })
    .limit(limit)
    .lean<PayoutRowLean[]>();

  const orderIds = payouts.map((row) => row.orderId);
  const businessIds = payouts.map((row) => row.businessId);
  const { orderMap, businessMap } = await loadOrderAndBusinessMaps(orderIds, businessIds);

  return payouts.map((row) => {
    const order = orderMap.get(String(row.orderId));
    const business = businessMap.get(String(row.businessId));
    return {
      payoutId: String(row._id),
      orderId: String(row.orderId),
      orderNumber: String(order?.orderNumber || ""),
      businessName: String(business?.name || ""),
      amount: Number(row.amount || 0),
      deliveryFeeCharged: Number(row.deliveryFeeCharged || 0),
      platformMargin: Number(row.platformMargin || 0),
      status: row.status,
      createdAt: row.createdAt || null,
      paidAt: row.paidAt || null,
    };
  });
}

export async function loadEarningsSummary(input: { cityId: mongoose.Types.ObjectId; driverId: mongoose.Types.ObjectId; weekKey?: string }) {
  const weekKey = normalizeWeekKeyOrDefault(input.weekKey);
  const baseMatch = { cityId: input.cityId, driverId: input.driverId };

  const [pendingAgg, paidAgg, lifetimeAgg, payoutAgg, completedAgg] = await Promise.all([
    RiderPayout.aggregate<{ pendingCount: number; pendingAmount: number }>([
      { $match: { ...baseMatch, status: "pending", weekKey } },
      {
        $group: {
          _id: null,
          pendingCount: { $sum: 1 },
          pendingAmount: { $sum: "$amount" },
        },
      },
    ]),
    RiderPayout.aggregate<{ paidCount: number; paidAmount: number }>([
      { $match: { ...baseMatch, status: "paid", weekKey } },
      {
        $group: {
          _id: null,
          paidCount: { $sum: 1 },
          paidAmount: { $sum: "$amount" },
        },
      },
    ]),
    RiderPayout.aggregate<{ lifetimePaidAmount: number }>([
      { $match: { ...baseMatch, status: "paid" } },
      { $group: { _id: null, lifetimePaidAmount: { $sum: "$amount" } } },
    ]),
    RiderPayout.aggregate<{ payoutBackedCount: number; payoutBackedAmount: number }>([
      { $match: { ...baseMatch, status: { $ne: "void" } } },
      {
        $group: {
          _id: null,
          payoutBackedCount: { $sum: 1 },
          payoutBackedAmount: { $sum: "$amount" },
        },
      },
    ]),
    Order.aggregate<{ completedOrdersCount: number; completedOrdersEarnings: number }>([
      {
        $match: {
          cityId: input.cityId,
          "dispatch.assignedDriverId": input.driverId,
          "deliverySnapshot.mode": "platform_driver",
          status: "delivered",
        },
      },
      {
        $group: {
          _id: null,
          completedOrdersCount: { $sum: 1 },
          completedOrdersEarnings: { $sum: "$riderPayoutExpectedAtOrderTime" },
        },
      },
    ]),
  ]);

  const payoutBackedCount = Number(payoutAgg[0]?.payoutBackedCount || 0);
  const payoutBackedAmount = Number(payoutAgg[0]?.payoutBackedAmount || 0);
  const completedOrdersCount = Number(completedAgg[0]?.completedOrdersCount || 0);
  const completedOrdersEarnings = Number(completedAgg[0]?.completedOrdersEarnings || 0);
  const hasPayoutRows = payoutBackedCount > 0;

  return {
    weekKey,
    pendingCount: Number(pendingAgg[0]?.pendingCount || 0),
    pendingAmount: Number(pendingAgg[0]?.pendingAmount || 0),
    paidCount: Number(paidAgg[0]?.paidCount || 0),
    paidAmount: Number(paidAgg[0]?.paidAmount || 0),
    lifetimePaidAmount: Number(lifetimeAgg[0]?.lifetimePaidAmount || 0),
    completedOrdersCount,
    completedOrdersEarnings,
    totalEarnings: hasPayoutRows ? payoutBackedAmount : completedOrdersEarnings,
    earningsSource: hasPayoutRows ? "rider_payouts" : "delivered_order_expected_payout",
  };
}

export async function loadReconciliationPreview(input: {
  cityId: mongoose.Types.ObjectId;
  driverId: mongoose.Types.ObjectId;
  weekKey?: string;
}) {
  const weekKey = normalizeWeekKeyOrDefault(input.weekKey);
  const payouts = await RiderPayout.find({
    cityId: input.cityId,
    driverId: input.driverId,
    weekKey,
    status: { $ne: "void" },
  })
    .sort({ createdAt: -1 })
    .lean<PayoutRowLean[]>();

  const orderIds = payouts.map((row) => row.orderId);
  const businessIds = payouts.map((row) => row.businessId);
  const { orderMap, businessMap } = await loadOrderAndBusinessMaps(orderIds, businessIds);

  const rows = payouts.map((row) => {
    const order = orderMap.get(String(row.orderId));
    const business = businessMap.get(String(row.businessId));
    return {
      orderId: String(row.orderId),
      orderNumber: String(order?.orderNumber || ""),
      businessName: String(business?.name || ""),
      deliveryFeeCharged: Number(row.deliveryFeeCharged || 0),
      riderPayoutAmount: Number(row.amount || 0),
      platformMargin: Number(row.platformMargin || 0),
      status: row.status,
      createdAt: row.createdAt || null,
    };
  });

  const cashCollectedByRider = rows.reduce((acc, row) => acc + Number(row.deliveryFeeCharged || 0), 0);
  const cashDueToRider = rows.reduce((acc, row) => acc + Number(row.riderPayoutAmount || 0), 0);
  const cashDueToPlatform = rows.reduce((acc, row) => acc + Number(row.platformMargin || 0), 0);
  const netSettlement = cashDueToRider - cashDueToPlatform;

  return {
    weekKey,
    totals: {
      cashCollectedByRider,
      cashDueToRider,
      cashDueToPlatform,
      netSettlement,
    },
    rows,
  };
}
