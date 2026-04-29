import mongoose from "mongoose";
import { ok, fail } from "@/lib/apiResponse";
import { requireDriverCityContext } from "@/lib/driverContext";
import { getPeriodKey } from "@/lib/driverIncentives";
import { assertNotInMaintenance } from "@/lib/maintenance";
import { dbConnect } from "@/lib/mongodb";
import { DriverIncentiveEarned } from "@/models/DriverIncentiveEarned";
import { IncentiveRule } from "@/models/IncentiveRule";

type ApiError = Error & { status?: number; code?: string };

type IncentiveStatus = "earned" | "paid";

type IncentiveEarnedLean = {
  _id: mongoose.Types.ObjectId;
  ruleId: mongoose.Types.ObjectId;
  rewardAmount: number;
  periodKey: string;
  status: IncentiveStatus;
  createdAt?: Date | null;
};

type IncentiveRuleNameLean = {
  _id: mongoose.Types.ObjectId;
  name: string;
};

export async function GET(req: Request) {
  try {
    await assertNotInMaintenance();
    await dbConnect();

    const { city, driver } = await requireDriverCityContext(req);
    const url = new URL(req.url);
    const period = String(url.searchParams.get("period") || "current")
      .trim()
      .toLowerCase();

    const cityId = new mongoose.Types.ObjectId(String(city._id));
    const driverId = new mongoose.Types.ObjectId(String(driver._id));
    const now = new Date();

    const query: Record<string, unknown> = {
      cityId,
      driverId,
    };
    if (period !== "all") {
      query.periodKey = {
        $in: [getPeriodKey("daily", now), getPeriodKey("weekly", now)],
      };
    }

    const earnedRows = await DriverIncentiveEarned.find(query)
      .sort({ createdAt: -1, _id: -1 })
      .lean<IncentiveEarnedLean[]>();

    const ruleIds = Array.from(
      new Set(earnedRows.map((row) => String(row.ruleId || "")).filter(Boolean))
    )
      .filter((value) => mongoose.Types.ObjectId.isValid(value))
      .map((value) => new mongoose.Types.ObjectId(value));

    const rules = ruleIds.length
      ? await IncentiveRule.find({ _id: { $in: ruleIds } })
          .select("_id name")
          .lean<IncentiveRuleNameLean[]>()
      : [];
    const ruleNameMap = new Map(rules.map((rule) => [String(rule._id), String(rule.name || "")]));

    let earnedTotal = 0;
    let paidTotal = 0;
    for (const row of earnedRows) {
      const rewardAmount = Number(row.rewardAmount || 0);
      if (row.status === "paid") paidTotal += rewardAmount;
      else earnedTotal += rewardAmount;
    }

    return ok({
      cityId: String(city._id),
      driverId: String(driver._id),
      earned: earnedRows.map((row) => ({
        incentiveId: String(row._id),
        ruleName: ruleNameMap.get(String(row.ruleId)) || "Incentive rule",
        rewardAmount: Number(row.rewardAmount || 0),
        periodKey: String(row.periodKey || ""),
        status: row.status,
        createdAt: row.createdAt ? new Date(row.createdAt).toISOString() : null,
      })),
      totals: {
        earnedTotal,
        paidTotal,
      },
    });
  } catch (error: unknown) {
    const err = error as ApiError;
    return fail(
      err.code || "SERVER_ERROR",
      err.message || "Could not load driver incentives.",
      err.status || 500
    );
  }
}
