import mongoose from "mongoose";
import { dbConnect } from "@/lib/mongodb";
import { ok, fail } from "@/lib/apiResponse";
import { requireAdminKey } from "@/lib/adminAuth";
import { assertNotInMaintenance } from "@/lib/maintenance";
import { getDefaultCity, cityCode, citySlug } from "@/lib/city";
import { Order } from "@/models/Order";
import { RiderPayout } from "@/models/RiderPayout";
import { City } from "@/models/City";

type ApiError = Error & { status?: number; code?: string };

function parseIso(value: string | null, fallback: Date) {
  if (!value) return fallback;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? fallback : parsed;
}

export async function GET(req: Request) {
  try {
    requireAdminKey(req);
    await assertNotInMaintenance();

    const url = new URL(req.url);
    const to = parseIso(url.searchParams.get("to"), new Date());
    const from = parseIso(
      url.searchParams.get("from"),
      new Date(to.getTime() - 7 * 24 * 60 * 60 * 1000)
    );
    if (from > to) {
      return fail("VALIDATION_ERROR", "Invalid range: from must be <= to.", 400);
    }

    await dbConnect();
    const defaultCity = await getDefaultCity();
    const defaultCityId = new mongoose.Types.ObjectId(String(defaultCity._id));

    const [orderAgg, payoutAgg, cities] = await Promise.all([
      Order.aggregate<{
        _id: mongoose.Types.ObjectId;
        ordersCount: number;
        deliveredCount: number;
        cancelledCount: number;
        grossSubtotal: number;
        commissionTotal: number;
        deliveryFeeTotal: number;
        deliveredBusinessIds: mongoose.Types.ObjectId[];
      }>([
        {
          $match: {
            createdAt: { $gte: from, $lte: to },
          },
        },
        {
          $addFields: {
            effectiveCityId: { $ifNull: ["$cityId", defaultCityId] },
          },
        },
        {
          $group: {
            _id: "$effectiveCityId",
            ordersCount: { $sum: 1 },
            deliveredCount: { $sum: { $cond: [{ $eq: ["$status", "delivered"] }, 1, 0] } },
            cancelledCount: { $sum: { $cond: [{ $eq: ["$status", "cancelled"] }, 1, 0] } },
            grossSubtotal: {
              $sum: { $cond: [{ $eq: ["$status", "delivered"] }, "$subtotal", 0] },
            },
            commissionTotal: {
              $sum: { $cond: [{ $eq: ["$status", "delivered"] }, "$commissionAmount", 0] },
            },
            deliveryFeeTotal: {
              $sum: { $cond: [{ $eq: ["$status", "delivered"] }, "$deliveryFeeToCustomer", 0] },
            },
            deliveredBusinessIds: {
              $addToSet: { $cond: [{ $eq: ["$status", "delivered"] }, "$businessId", "$$REMOVE"] },
            },
          },
        },
      ]),
      RiderPayout.aggregate<{
        _id: mongoose.Types.ObjectId;
        riderPayoutTotal: number;
        platformDeliveryMarginTotal: number;
      }>([
        {
          $match: {
            createdAt: { $gte: from, $lte: to },
          },
        },
        {
          $addFields: {
            effectiveCityId: { $ifNull: ["$cityId", defaultCityId] },
          },
        },
        {
          $group: {
            _id: "$effectiveCityId",
            riderPayoutTotal: { $sum: "$amount" },
            platformDeliveryMarginTotal: { $sum: "$platformMargin" },
          },
        },
      ]),
      City.find({})
        .select("_id code slug name country")
        .lean<Array<{ _id: mongoose.Types.ObjectId; code?: string; slug?: string; name?: string; country?: string }>>(),
    ]);

    const orderMap = new Map(orderAgg.map((row) => [String(row._id), row]));
    const payoutMap = new Map(payoutAgg.map((row) => [String(row._id), row]));
    const cityMetaMap = new Map(cities.map((city) => [String(city._id), city]));

    const allCityIds = new Set<string>([
      ...Array.from(orderMap.keys()),
      ...Array.from(payoutMap.keys()),
      String(defaultCity._id),
    ]);

    const rows = Array.from(allCityIds).map((cityId) => {
      const order = orderMap.get(cityId);
      const payout = payoutMap.get(cityId);
      const cityMeta = cityMetaMap.get(cityId);
      const deliveredBusinessIds = Array.isArray(order?.deliveredBusinessIds) ? order?.deliveredBusinessIds : [];
      return {
        cityId,
        cityCode: cityCode({
          code: String(cityMeta?.code || (cityId === String(defaultCity._id) ? defaultCity.code : "")),
        }),
        citySlug: citySlug({
          slug: String(cityMeta?.slug || (cityId === String(defaultCity._id) ? defaultCity.slug : "")),
          name: String(cityMeta?.name || (cityId === String(defaultCity._id) ? defaultCity.name : "")),
        }),
        cityName: String(cityMeta?.name || (cityId === String(defaultCity._id) ? defaultCity.name : cityId)),
        country: String(cityMeta?.country || (cityId === String(defaultCity._id) ? defaultCity.country : "")),
        ordersCount: Number(order?.ordersCount || 0),
        deliveredCount: Number(order?.deliveredCount || 0),
        cancelledCount: Number(order?.cancelledCount || 0),
        grossSubtotal: Number(order?.grossSubtotal || 0),
        commissionTotal: Number(order?.commissionTotal || 0),
        deliveryFeeTotal: Number(order?.deliveryFeeTotal || 0),
        riderPayoutTotal: Number(payout?.riderPayoutTotal || 0),
        platformDeliveryMarginTotal: Number(payout?.platformDeliveryMarginTotal || 0),
        uniqueBusinesses: deliveredBusinessIds.length,
      };
    });

    rows.sort((a, b) => b.ordersCount - a.ordersCount);

    return ok({
      from: from.toISOString(),
      to: to.toISOString(),
      rows,
    });
  } catch (error: unknown) {
    const err = error as ApiError;
    return fail(
      err.code || "SERVER_ERROR",
      err.message || "Could not load analytics by city.",
      err.status || 500
    );
  }
}
