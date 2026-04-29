import mongoose from "mongoose";
import { getWeekKey } from "@/lib/geo";
import { DriverIncentiveEarned } from "@/models/DriverIncentiveEarned";
import { IncentiveRule } from "@/models/IncentiveRule";
import { Order } from "@/models/Order";
import { RiderPayout } from "@/models/RiderPayout";

export type IncentiveRuleType = "deliveries_count" | "revenue_amount" | "peak_hours";
export type IncentivePeriod = "daily" | "weekly";

type DriverIncentiveMetricSet = Record<IncentiveRuleType, number>;

type IncentiveRuleLean = {
  _id: mongoose.Types.ObjectId;
  cityId: mongoose.Types.ObjectId;
  name: string;
  type: IncentiveRuleType;
  threshold: number;
  rewardAmount: number;
  period: IncentivePeriod;
  isActive?: boolean;
  startsAt?: Date | null;
  endsAt?: Date | null;
};

type DeliveredOrderLean = {
  _id: mongoose.Types.ObjectId;
  sla?: {
    deliveredAt?: Date | null;
  };
};

type EvaluateDriverIncentivesResult = {
  cityId: string;
  driverId: string;
  created: Array<{
    ruleId: string;
    periodKey: string;
    rewardAmount: number;
    measuredValue: number;
  }>;
  metrics: Partial<Record<IncentivePeriod, DriverIncentiveMetricSet>>;
};

function toObjectId(value: mongoose.Types.ObjectId | string) {
  return value instanceof mongoose.Types.ObjectId
    ? value
    : new mongoose.Types.ObjectId(String(value));
}

function formatDailyKey(date: Date) {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
  )
    .toISOString()
    .slice(0, 10);
}

function getPeriodBounds(period: IncentivePeriod, date: Date) {
  if (period === "daily") {
    const start = new Date(
      Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
    );
    const end = new Date(start);
    end.setUTCDate(end.getUTCDate() + 1);
    return { start, end };
  }

  const start = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
  );
  const day = start.getUTCDay() || 7;
  start.setUTCDate(start.getUTCDate() - day + 1);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 7);
  return { start, end };
}

async function loadPeriodMetrics(input: {
  cityId: mongoose.Types.ObjectId;
  driverId: mongoose.Types.ObjectId;
  period: IncentivePeriod;
  date: Date;
}): Promise<DriverIncentiveMetricSet> {
  const { start, end } = getPeriodBounds(input.period, input.date);

  const [deliveredOrders, payoutRows] = await Promise.all([
    Order.find({
      cityId: input.cityId,
      status: "delivered",
      "dispatch.assignedDriverId": input.driverId,
      "sla.deliveredAt": { $gte: start, $lt: end },
    })
      .select("_id sla.deliveredAt")
      .lean<DeliveredOrderLean[]>(),
    RiderPayout.aggregate<{ total?: number }>([
      {
        $match: {
          cityId: input.cityId,
          driverId: input.driverId,
          status: { $ne: "void" },
          createdAt: { $gte: start, $lt: end },
        },
      },
      {
        $group: {
          _id: null,
          total: { $sum: "$amount" },
        },
      },
    ]),
  ]);

  const peakHours = deliveredOrders.reduce((count, order) => {
    const deliveredAt = order.sla?.deliveredAt ? new Date(order.sla.deliveredAt) : null;
    if (!deliveredAt || Number.isNaN(deliveredAt.getTime())) return count;
    const hour = deliveredAt.getHours();
    return count + (hour >= 18 && hour < 22 ? 1 : 0);
  }, 0);

  return {
    deliveries_count: deliveredOrders.length,
    revenue_amount: Number(payoutRows[0]?.total || 0),
    peak_hours: peakHours,
  };
}

function isDuplicateKeyError(error: unknown) {
  const code = String((error as { code?: number | string })?.code || "");
  const message = String((error as { message?: string })?.message || "");
  return code === "11000" || /E11000/.test(message);
}

export function getPeriodKey(period: IncentivePeriod, date = new Date()) {
  return period === "daily" ? formatDailyKey(date) : getWeekKey(date);
}

export async function evaluateDriverIncentives(input: {
  cityId: mongoose.Types.ObjectId | string;
  driverId: mongoose.Types.ObjectId | string;
  date?: Date;
}): Promise<EvaluateDriverIncentivesResult> {
  const cityId = toObjectId(input.cityId);
  const driverId = toObjectId(input.driverId);
  const evaluationDate =
    input.date instanceof Date && !Number.isNaN(input.date.getTime()) ? input.date : new Date();

  const rules = await IncentiveRule.find({
    cityId,
    isActive: true,
    $and: [
      {
        $or: [{ startsAt: null }, { startsAt: { $exists: false } }, { startsAt: { $lte: evaluationDate } }],
      },
      {
        $or: [{ endsAt: null }, { endsAt: { $exists: false } }, { endsAt: { $gte: evaluationDate } }],
      },
    ],
  })
    .sort({ createdAt: 1, _id: 1 })
    .lean<IncentiveRuleLean[]>();

  if (!rules.length) {
    return {
      cityId: String(cityId),
      driverId: String(driverId),
      created: [],
      metrics: {},
    };
  }

  const metricCache = new Map<IncentivePeriod, DriverIncentiveMetricSet>();
  const created: EvaluateDriverIncentivesResult["created"] = [];
  const metrics: Partial<Record<IncentivePeriod, DriverIncentiveMetricSet>> = {};

  for (const rule of rules) {
    let periodMetrics = metricCache.get(rule.period);
    if (!periodMetrics) {
      periodMetrics = await loadPeriodMetrics({
        cityId,
        driverId,
        period: rule.period,
        date: evaluationDate,
      });
      metricCache.set(rule.period, periodMetrics);
      metrics[rule.period] = periodMetrics;
    }

    const measuredValue = Number(periodMetrics[rule.type] || 0);
    if (measuredValue < Number(rule.threshold || 0)) {
      continue;
    }

    const periodKey = getPeriodKey(rule.period, evaluationDate);
    try {
      const write = await DriverIncentiveEarned.updateOne(
        {
          cityId,
          driverId,
          ruleId: rule._id,
          periodKey,
        },
        {
          $setOnInsert: {
            cityId,
            driverId,
            ruleId: rule._id,
            periodKey,
            rewardAmount: Number(rule.rewardAmount || 0),
            status: "earned",
            meta: {
              ruleName: String(rule.name || ""),
              ruleType: rule.type,
              period: rule.period,
              threshold: Number(rule.threshold || 0),
              measuredValue,
              evaluatedAt: evaluationDate,
            },
          },
        },
        { upsert: true }
      );

      if (Number((write as { upsertedCount?: number }).upsertedCount || 0) > 0) {
        created.push({
          ruleId: String(rule._id),
          periodKey,
          rewardAmount: Number(rule.rewardAmount || 0),
          measuredValue,
        });
      }
    } catch (error: unknown) {
      if (!isDuplicateKeyError(error)) {
        throw error;
      }
    }
  }

  return {
    cityId: String(cityId),
    driverId: String(driverId),
    created,
    metrics,
  };
}

export async function evaluateAllDriversForCity(input: {
  cityId: mongoose.Types.ObjectId | string;
  date?: Date;
}) {
  const cityId = toObjectId(input.cityId);
  const evaluationDate =
    input.date instanceof Date && !Number.isNaN(input.date.getTime()) ? input.date : new Date();

  const activeRules = await IncentiveRule.find({
    cityId,
    isActive: true,
    $and: [
      {
        $or: [{ startsAt: null }, { startsAt: { $exists: false } }, { startsAt: { $lte: evaluationDate } }],
      },
      {
        $or: [{ endsAt: null }, { endsAt: { $exists: false } }, { endsAt: { $gte: evaluationDate } }],
      },
    ],
  })
    .select("_id period")
    .lean<Array<{ _id: mongoose.Types.ObjectId; period: IncentivePeriod }>>();

  if (!activeRules.length) {
    return {
      cityId: String(cityId),
      evaluatedDrivers: 0,
      createdCount: 0,
    };
  }

  const periods = Array.from(new Set(activeRules.map((rule) => rule.period)));
  const driverIds = new Set<string>();

  for (const period of periods) {
    const { start, end } = getPeriodBounds(period, evaluationDate);
    const [payoutDrivers, deliveredDrivers] = await Promise.all([
      RiderPayout.distinct("driverId", {
        cityId,
        driverId: { $ne: null },
        status: { $ne: "void" },
        createdAt: { $gte: start, $lt: end },
      }),
      Order.distinct("dispatch.assignedDriverId", {
        cityId,
        status: "delivered",
        "dispatch.assignedDriverId": { $ne: null },
        "sla.deliveredAt": { $gte: start, $lt: end },
      }),
    ]);

    for (const driverId of [...payoutDrivers, ...deliveredDrivers]) {
      if (mongoose.Types.ObjectId.isValid(String(driverId || ""))) {
        driverIds.add(String(driverId));
      }
    }
  }

  let createdCount = 0;
  for (const driverId of driverIds) {
    const result = await evaluateDriverIncentives({
      cityId,
      driverId,
      date: evaluationDate,
    });
    createdCount += result.created.length;
  }

  return {
    cityId: String(cityId),
    evaluatedDrivers: driverIds.size,
    createdCount,
  };
}
