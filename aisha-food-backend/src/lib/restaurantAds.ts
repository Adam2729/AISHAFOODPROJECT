import mongoose from "mongoose";
import { RestaurantAdCampaign } from "@/models/RestaurantAdCampaign";
import { RestaurantAdClick } from "@/models/RestaurantAdClick";
import { RestaurantAdImpression } from "@/models/RestaurantAdImpression";

export const RESTAURANT_AD_COST_PER_CLICK = 25;

type CampaignLean = {
  _id: mongoose.Types.ObjectId;
  cityId: mongoose.Types.ObjectId;
  businessId: mongoose.Types.ObjectId;
  name?: string;
  dailyBudget?: number;
  totalBudget?: number;
  spent?: number;
  startDate?: Date | null;
  endDate?: Date | null;
  priority?: number;
  isActive?: boolean;
  createdAt?: Date | null;
  updatedAt?: Date | null;
};

type CampaignCounterAgg = {
  _id: mongoose.Types.ObjectId;
  count?: number;
  spent?: number;
};

function toObjectId(value: mongoose.Types.ObjectId | string) {
  return value instanceof mongoose.Types.ObjectId
    ? value
    : new mongoose.Types.ObjectId(String(value));
}

export function startOfLocalDay(date = new Date()) {
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  return start;
}

export function endOfLocalDay(date = new Date()) {
  const end = startOfLocalDay(date);
  end.setDate(end.getDate() + 1);
  return end;
}

export function getRestaurantAdCampaignStatus(input: {
  campaign: Pick<
    CampaignLean,
    "isActive" | "startDate" | "endDate" | "dailyBudget" | "totalBudget" | "spent"
  >;
  now?: Date;
  spentToday?: number;
}) {
  const now = input.now || new Date();
  const spentToday = Math.max(0, Number(input.spentToday || 0));
  const totalSpent = Math.max(0, Number(input.campaign.spent || 0));
  const totalBudget = Math.max(0, Number(input.campaign.totalBudget || 0));
  const dailyBudget = Math.max(0, Number(input.campaign.dailyBudget || 0));
  const startDate = input.campaign.startDate ? new Date(input.campaign.startDate) : null;
  const endDate = input.campaign.endDate ? new Date(input.campaign.endDate) : null;

  if (!input.campaign.isActive) return "inactive";
  if (startDate && startDate.getTime() > now.getTime()) return "scheduled";
  if (endDate && endDate.getTime() < now.getTime()) return "ended";
  if (totalBudget > 0 && totalSpent >= totalBudget) return "budget_exhausted";
  if (dailyBudget > 0 && spentToday >= dailyBudget) return "daily_budget_exhausted";
  return "active";
}

export function canServeRestaurantAdCampaign(input: {
  campaign: Pick<
    CampaignLean,
    "isActive" | "startDate" | "endDate" | "dailyBudget" | "totalBudget" | "spent"
  >;
  spentToday?: number;
  now?: Date;
  nextCost?: number;
}) {
  const status = getRestaurantAdCampaignStatus(input);
  if (status !== "active") return false;

  const nextCost = Math.max(0, Number(input.nextCost || 0));
  const totalSpent = Math.max(0, Number(input.campaign.spent || 0));
  const totalBudget = Math.max(0, Number(input.campaign.totalBudget || 0));
  const dailyBudget = Math.max(0, Number(input.campaign.dailyBudget || 0));
  const spentToday = Math.max(0, Number(input.spentToday || 0));

  if (totalBudget > 0 && totalSpent + nextCost > totalBudget) return false;
  if (dailyBudget > 0 && spentToday + nextCost > dailyBudget) return false;
  return true;
}

export async function getRestaurantAdAnalytics(input: {
  campaignIds: Array<mongoose.Types.ObjectId | string>;
  now?: Date;
}) {
  const campaignIds = input.campaignIds
    .map((value) => String(value || "").trim())
    .filter((value) => mongoose.Types.ObjectId.isValid(value))
    .map((value) => new mongoose.Types.ObjectId(value));

  if (!campaignIds.length) {
    return {
      impressionsByCampaignId: new Map<string, number>(),
      clicksByCampaignId: new Map<string, number>(),
      spentTodayByCampaignId: new Map<string, number>(),
    };
  }

  const now = input.now || new Date();
  const dayStart = startOfLocalDay(now);
  const dayEnd = endOfLocalDay(now);

  const [impressionsAgg, clicksAgg, spentTodayAgg] = await Promise.all([
    RestaurantAdImpression.aggregate<CampaignCounterAgg>([
      { $match: { campaignId: { $in: campaignIds } } },
      { $group: { _id: "$campaignId", count: { $sum: 1 } } },
    ]),
    RestaurantAdClick.aggregate<CampaignCounterAgg>([
      { $match: { campaignId: { $in: campaignIds } } },
      { $group: { _id: "$campaignId", count: { $sum: 1 } } },
    ]),
    RestaurantAdClick.aggregate<CampaignCounterAgg>([
      {
        $match: {
          campaignId: { $in: campaignIds },
          timestamp: { $gte: dayStart, $lt: dayEnd },
        },
      },
      { $group: { _id: "$campaignId", spent: { $sum: "$cost" } } },
    ]),
  ]);

  return {
    impressionsByCampaignId: new Map(
      impressionsAgg.map((row) => [String(row._id), Number(row.count || 0)])
    ),
    clicksByCampaignId: new Map(
      clicksAgg.map((row) => [String(row._id), Number(row.count || 0)])
    ),
    spentTodayByCampaignId: new Map(
      spentTodayAgg.map((row) => [String(row._id), Number(row.spent || 0)])
    ),
  };
}

export async function getActiveRestaurantCampaignMap(input: {
  cityId: mongoose.Types.ObjectId | string;
  businessIds?: Array<mongoose.Types.ObjectId | string>;
  now?: Date;
}) {
  const cityId = toObjectId(input.cityId);
  const businessIds = Array.isArray(input.businessIds)
    ? input.businessIds
        .map((value) => String(value || "").trim())
        .filter((value) => mongoose.Types.ObjectId.isValid(value))
        .map((value) => new mongoose.Types.ObjectId(value))
    : [];
  const now = input.now || new Date();

  const query: Record<string, unknown> = {
    cityId,
    isActive: true,
  };
  if (businessIds.length) {
    query.businessId = { $in: businessIds };
  }

  const campaigns = await RestaurantAdCampaign.find(query)
    .sort({ priority: -1, createdAt: -1, _id: 1 })
    .lean<CampaignLean[]>();
  const analytics = await getRestaurantAdAnalytics({
    campaignIds: campaigns.map((campaign) => campaign._id),
    now,
  });

  const activeByBusinessId = new Map<string, CampaignLean>();
  for (const campaign of campaigns) {
    const spentToday = Number(analytics.spentTodayByCampaignId.get(String(campaign._id)) || 0);
    if (!canServeRestaurantAdCampaign({ campaign, spentToday, now })) continue;
    const businessId = String(campaign.businessId);
    const current = activeByBusinessId.get(businessId);
    if (!current) {
      activeByBusinessId.set(businessId, campaign);
      continue;
    }
    const priorityDiff = Number(campaign.priority || 0) - Number(current.priority || 0);
    if (priorityDiff > 0) {
      activeByBusinessId.set(businessId, campaign);
      continue;
    }
    if (priorityDiff === 0) {
      const currentCreatedAt = current.createdAt ? new Date(current.createdAt).getTime() : 0;
      const nextCreatedAt = campaign.createdAt ? new Date(campaign.createdAt).getTime() : 0;
      if (nextCreatedAt > currentCreatedAt) {
        activeByBusinessId.set(businessId, campaign);
      }
    }
  }

  return {
    campaignsByBusinessId: activeByBusinessId,
    campaigns,
    analytics,
  };
}
