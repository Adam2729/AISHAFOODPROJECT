import mongoose from "mongoose";
import { fail, ok, readJson } from "@/lib/apiResponse";
import { requireAdminKey } from "@/lib/adminAuth";
import { requireActiveCity, resolveCityFromRequest } from "@/lib/city";
import { dbConnect } from "@/lib/mongodb";
import {
  getRestaurantAdAnalytics,
  getRestaurantAdCampaignStatus,
} from "@/lib/restaurantAds";
import { Business } from "@/models/Business";
import { City } from "@/models/City";
import { RestaurantAdCampaign } from "@/models/RestaurantAdCampaign";

type ApiError = Error & { status?: number; code?: string };

type CreateCampaignBody = {
  cityId?: string;
  businessId?: string;
  name?: string;
  dailyBudget?: number;
  totalBudget?: number;
  startDate?: string;
  endDate?: string;
  priority?: number;
};

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

function mapCampaignRow(input: {
  campaign: CampaignLean;
  cityName?: string | null;
  cityCode?: string | null;
  businessName?: string | null;
  impressions: number;
  clicks: number;
  spentToday: number;
}) {
  const status = getRestaurantAdCampaignStatus({
    campaign: input.campaign,
    spentToday: input.spentToday,
  });
  const remainingBudget = Math.max(
    0,
    Number(input.campaign.totalBudget || 0) - Number(input.campaign.spent || 0)
  );

  return {
    id: String(input.campaign._id),
    cityId: String(input.campaign.cityId),
    cityName: String(input.cityName || "").trim() || null,
    cityCode: String(input.cityCode || "").trim() || null,
    businessId: String(input.campaign.businessId),
    businessName: String(input.businessName || "").trim() || null,
    name: String(input.campaign.name || ""),
    dailyBudget: Number(input.campaign.dailyBudget || 0),
    totalBudget: Number(input.campaign.totalBudget || 0),
    spent: Number(input.campaign.spent || 0),
    spentToday: Number(input.spentToday || 0),
    remainingBudget,
    startDate: input.campaign.startDate
      ? new Date(input.campaign.startDate).toISOString()
      : null,
    endDate: input.campaign.endDate ? new Date(input.campaign.endDate).toISOString() : null,
    priority: Number(input.campaign.priority || 0),
    isActive: Boolean(input.campaign.isActive),
    status,
    impressions: Number(input.impressions || 0),
    clicks: Number(input.clicks || 0),
    ctr:
      Number(input.impressions || 0) > 0
        ? Number(
            (
              (Number(input.clicks || 0) / Math.max(1, Number(input.impressions || 0))) *
              100
            ).toFixed(2)
          )
        : 0,
    createdAt: input.campaign.createdAt
      ? new Date(input.campaign.createdAt).toISOString()
      : null,
  };
}

export async function GET(req: Request) {
  try {
    requireAdminKey(req);
    await dbConnect();

    const url = new URL(req.url);
    const cityId = String(url.searchParams.get("cityId") || "").trim();
    if (cityId && !mongoose.Types.ObjectId.isValid(cityId)) {
      return fail("VALIDATION_ERROR", "cityId is invalid.", 400);
    }

    const query: Record<string, unknown> = {};
    if (cityId) {
      query.cityId = new mongoose.Types.ObjectId(cityId);
    }

    const campaigns = await RestaurantAdCampaign.find(query)
      .sort({ isActive: -1, priority: -1, createdAt: -1, _id: -1 })
      .lean<CampaignLean[]>();

    const analytics = await getRestaurantAdAnalytics({
      campaignIds: campaigns.map((campaign) => campaign._id),
    });

    const businessIds = Array.from(
      new Set(campaigns.map((campaign) => String(campaign.businessId)))
    )
      .filter((value) => mongoose.Types.ObjectId.isValid(value))
      .map((value) => new mongoose.Types.ObjectId(value));
    const cityIds = Array.from(new Set(campaigns.map((campaign) => String(campaign.cityId))))
      .filter((value) => mongoose.Types.ObjectId.isValid(value))
      .map((value) => new mongoose.Types.ObjectId(value));

    const [businesses, cities] = await Promise.all([
      businessIds.length
        ? Business.find({ _id: { $in: businessIds } })
            .select("_id name")
            .lean<Array<{ _id: mongoose.Types.ObjectId; name?: string }>>()
        : Promise.resolve([]),
      cityIds.length
        ? City.find({ _id: { $in: cityIds } })
            .select("_id name code")
            .lean<Array<{ _id: mongoose.Types.ObjectId; name?: string; code?: string }>>()
        : Promise.resolve([]),
    ]);

    const businessNameById = new Map(
      businesses.map((business) => [String(business._id), String(business.name || "")])
    );
    const cityById = new Map(
      cities.map((city) => [
        String(city._id),
        { name: String(city.name || ""), code: String(city.code || "") },
      ])
    );

    return ok({
      rows: campaigns.map((campaign) => {
        const city = cityById.get(String(campaign.cityId));
        return mapCampaignRow({
          campaign,
          cityName: city?.name || null,
          cityCode: city?.code || null,
          businessName: businessNameById.get(String(campaign.businessId)) || null,
          impressions: Number(
            analytics.impressionsByCampaignId.get(String(campaign._id)) || 0
          ),
          clicks: Number(analytics.clicksByCampaignId.get(String(campaign._id)) || 0),
          spentToday: Number(
            analytics.spentTodayByCampaignId.get(String(campaign._id)) || 0
          ),
        });
      }),
    });
  } catch (error: unknown) {
    const err = error as ApiError;
    return fail(
      err.code || "SERVER_ERROR",
      err.message || "Could not load ad campaigns.",
      err.status || 500
    );
  }
}

export async function POST(req: Request) {
  try {
    requireAdminKey(req);
    await dbConnect();

    const body = await readJson<CreateCampaignBody>(req);
    const bodyCityId = String(body.cityId || "").trim();
    const businessId = String(body.businessId || "").trim();
    const name = String(body.name || "").trim().slice(0, 120);
    const dailyBudget = Math.max(0, Number(body.dailyBudget || 0));
    const totalBudget = Math.max(0, Number(body.totalBudget || 0));
    const priority = Math.max(0, Math.floor(Number(body.priority || 1)));
    const startDate = body.startDate ? new Date(body.startDate) : null;
    const endDate = body.endDate ? new Date(body.endDate) : null;

    if (bodyCityId && !mongoose.Types.ObjectId.isValid(bodyCityId)) {
      return fail("VALIDATION_ERROR", "cityId is invalid.", 400);
    }
    if (!mongoose.Types.ObjectId.isValid(businessId)) {
      return fail("VALIDATION_ERROR", "businessId is invalid.", 400);
    }
    if (!name) {
      return fail("VALIDATION_ERROR", "name is required.", 400);
    }
    if (!Number.isFinite(dailyBudget) || dailyBudget <= 0) {
      return fail("VALIDATION_ERROR", "dailyBudget must be greater than zero.", 400);
    }
    if (!Number.isFinite(totalBudget) || totalBudget <= 0) {
      return fail("VALIDATION_ERROR", "totalBudget must be greater than zero.", 400);
    }
    if (!startDate || Number.isNaN(startDate.getTime())) {
      return fail("VALIDATION_ERROR", "startDate is invalid.", 400);
    }
    if (!endDate || Number.isNaN(endDate.getTime())) {
      return fail("VALIDATION_ERROR", "endDate is invalid.", 400);
    }
    if (endDate.getTime() < startDate.getTime()) {
      return fail("VALIDATION_ERROR", "endDate must be after startDate.", 400);
    }

    const selectedCity = bodyCityId
      ? await City.findById(bodyCityId).lean<{
          _id: mongoose.Types.ObjectId;
          code: string;
          name: string;
          country: string;
          isActive: boolean;
        } | null>()
      : await resolveCityFromRequest(req);

    if (!selectedCity) {
      return fail("CITY_NOT_FOUND", "City not found.", 404);
    }
    requireActiveCity(selectedCity);

    const business = await Business.findById(businessId)
      .select("_id cityId type isActive name")
      .lean<{
        _id: mongoose.Types.ObjectId;
        cityId?: mongoose.Types.ObjectId | null;
        type?: string;
        isActive?: boolean;
        name?: string;
      } | null>();

    if (!business || business.type !== "restaurant") {
      return fail("NOT_FOUND", "Restaurant not found.", 404);
    }
    if (String(business.cityId || "") !== String(selectedCity._id)) {
      return fail("CITY_MISMATCH", "Restaurant must belong to the selected city.", 409);
    }

    const created = await RestaurantAdCampaign.create({
      cityId: new mongoose.Types.ObjectId(String(selectedCity._id)),
      businessId: new mongoose.Types.ObjectId(businessId),
      name,
      dailyBudget,
      totalBudget,
      spent: 0,
      startDate,
      endDate,
      priority,
      isActive: true,
    });

    return ok(
      {
        campaign: mapCampaignRow({
          campaign: created.toObject() as CampaignLean,
          cityName: String((selectedCity as { name?: string }).name || ""),
          cityCode: String((selectedCity as { code?: string }).code || ""),
          businessName: String(business.name || ""),
          impressions: 0,
          clicks: 0,
          spentToday: 0,
        }),
      },
      201
    );
  } catch (error: unknown) {
    const err = error as ApiError;
    return fail(
      err.code || "SERVER_ERROR",
      err.message || "Could not create ad campaign.",
      err.status || 500
    );
  }
}
