import mongoose from "mongoose";
import { fail, ok, readJson } from "@/lib/apiResponse";
import { requireActiveCity, resolveCityFromRequest } from "@/lib/city";
import { dbConnect } from "@/lib/mongodb";
import {
  canServeRestaurantAdCampaign,
  getRestaurantAdAnalytics,
  RESTAURANT_AD_COST_PER_CLICK,
} from "@/lib/restaurantAds";
import { RestaurantAdCampaign } from "@/models/RestaurantAdCampaign";
import { RestaurantAdClick } from "@/models/RestaurantAdClick";
import { Business } from "@/models/Business";

type ApiError = Error & { status?: number; code?: string };

type ClickBody = {
  cityId?: string;
  campaignId?: string;
  businessId?: string;
};

export async function POST(req: Request) {
  try {
    await dbConnect();
    const selectedCity = await resolveCityFromRequest(req);
    requireActiveCity(selectedCity);

    const body = await readJson<ClickBody>(req);
    const campaignId = String(body.campaignId || "").trim();
    const businessId = String(body.businessId || "").trim();

    if (!mongoose.Types.ObjectId.isValid(campaignId)) {
      return fail("VALIDATION_ERROR", "campaignId is invalid.", 400);
    }
    if (!mongoose.Types.ObjectId.isValid(businessId)) {
      return fail("VALIDATION_ERROR", "businessId is invalid.", 400);
    }

    const [campaign, business] = await Promise.all([
      RestaurantAdCampaign.findById(campaignId).lean<{
        _id: mongoose.Types.ObjectId;
        cityId: mongoose.Types.ObjectId;
        businessId: mongoose.Types.ObjectId;
        dailyBudget?: number;
        totalBudget?: number;
        spent?: number;
        startDate?: Date | null;
        endDate?: Date | null;
        priority?: number;
        isActive?: boolean;
      } | null>(),
      Business.findById(businessId)
        .select("_id cityId type isActive")
        .lean<{
          _id: mongoose.Types.ObjectId;
          cityId?: mongoose.Types.ObjectId | null;
          type?: string;
          isActive?: boolean;
        } | null>(),
    ]);

    if (!campaign) {
      return fail("NOT_FOUND", "Campaign not found.", 404);
    }
    if (!business || business.type !== "restaurant" || !business.isActive) {
      return fail("NOT_FOUND", "Restaurant not found.", 404);
    }
    if (String(campaign.businessId) !== businessId) {
      return fail("CAMPAIGN_MISMATCH", "Campaign does not belong to this restaurant.", 409);
    }
    if (String(campaign.cityId) !== String(selectedCity._id)) {
      return fail("CITY_MISMATCH", "Campaign is outside the selected city.", 409);
    }
    if (String(business.cityId || "") !== String(selectedCity._id)) {
      return fail("CITY_MISMATCH", "Restaurant is outside the selected city.", 409);
    }

    const analytics = await getRestaurantAdAnalytics({
      campaignIds: [campaign._id],
    });
    const spentToday = Number(analytics.spentTodayByCampaignId.get(String(campaign._id)) || 0);
    if (
      !canServeRestaurantAdCampaign({
        campaign,
        spentToday,
        nextCost: RESTAURANT_AD_COST_PER_CLICK,
      })
    ) {
      return fail("CAMPAIGN_INACTIVE", "Campaign is not available for clicks.", 409);
    }

    const updatedCampaign = await RestaurantAdCampaign.findOneAndUpdate(
      {
        _id: campaign._id,
        cityId: new mongoose.Types.ObjectId(String(selectedCity._id)),
        businessId: new mongoose.Types.ObjectId(businessId),
        spent: Number(campaign.spent || 0),
      },
      {
        $inc: {
          spent: RESTAURANT_AD_COST_PER_CLICK,
        },
      },
      {
        returnDocument: "after",
      }
    ).lean<{
      _id: mongoose.Types.ObjectId;
      spent?: number;
    } | null>();

    if (!updatedCampaign) {
      return fail("CONFLICT", "Campaign spend changed. Retry click tracking.", 409);
    }

    try {
      await RestaurantAdClick.create({
        cityId: new mongoose.Types.ObjectId(String(selectedCity._id)),
        businessId: new mongoose.Types.ObjectId(businessId),
        campaignId: campaign._id,
        cost: RESTAURANT_AD_COST_PER_CLICK,
        timestamp: new Date(),
      });
    } catch (clickError: unknown) {
      await RestaurantAdCampaign.updateOne(
        { _id: campaign._id },
        {
          $inc: {
            spent: -RESTAURANT_AD_COST_PER_CLICK,
          },
        }
      ).catch(() => null);
      throw clickError;
    }

    return ok({
      campaignId: String(campaign._id),
      businessId,
      clickTracked: true,
      costPerClick: RESTAURANT_AD_COST_PER_CLICK,
      spent: Number(updatedCampaign.spent || 0),
    });
  } catch (error: unknown) {
    const err = error as ApiError;
    return fail(
      err.code || "SERVER_ERROR",
      err.message || "Could not track ad click.",
      err.status || 500
    );
  }
}
