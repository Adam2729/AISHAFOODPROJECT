import { dbConnect } from "@/lib/mongodb";
import { getBoolSetting, getNumberSetting } from "@/lib/appSettings";
import { Order } from "@/models/Order";

type SumAgg = { _id: null; total: number };

function toNumber(value: unknown) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

export async function getPromoPolicyForWeek(weekKey: string): Promise<{
  promosEnabled: boolean;
  weeklyBudgetRdp: number;
  spentRdp: number;
  remainingRdp: number;
}> {
  const [promosEnabled, weeklyBudgetRdp] = await Promise.all([
    getBoolSetting("promos_enabled", true),
    getNumberSetting("promo_budget_weekly_rdp", 5000),
  ]);

  await dbConnect();
  const spentAgg = await Order.aggregate<SumAgg>([
    {
      $match: {
        "settlement.weekKey": String(weekKey || "").trim(),
        status: "delivered",
        "discount.source": "promo",
      },
    },
    { $group: { _id: null, total: { $sum: { $ifNull: ["$discount.amount", 0] } } } },
  ]);

  const spentRdp = toNumber(spentAgg[0]?.total);
  const safeBudget = Math.max(0, toNumber(weeklyBudgetRdp));
  const remainingRdp = Math.max(0, safeBudget - spentRdp);

  return {
    promosEnabled: Boolean(promosEnabled),
    weeklyBudgetRdp: safeBudget,
    spentRdp,
    remainingRdp,
  };
}

export function budgetBlocksDiscount(remaining: number, discountAmount: number): boolean {
  const safeRemaining = Math.max(0, toNumber(remaining));
  const safeDiscount = Math.max(0, toNumber(discountAmount));
  return safeRemaining <= 0 || safeDiscount > safeRemaining;
}
