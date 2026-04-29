import mongoose from "mongoose";
import { dbConnect } from "@/lib/mongodb";
import { ok, fail } from "@/lib/apiResponse";
import { requireAdminKey } from "@/lib/adminAuth";
import { assertNotInMaintenance } from "@/lib/maintenance";
import { getDefaultCity, cityCode, citySlug } from "@/lib/city";
import { Order } from "@/models/Order";
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

    const [rows, cities] = await Promise.all([
      Order.aggregate<{
        _id: mongoose.Types.ObjectId;
        assignedCount: number;
        deliveredWithDriverCount: number;
        avgTimeToAcceptMins: number | null;
        avgTotalMins: number | null;
      }>([
        {
          $match: {
            createdAt: { $gte: from, $lte: to },
          },
        },
        {
          $addFields: {
            effectiveCityId: { $ifNull: ["$cityId", defaultCityId] },
            hasAssignedDriver: {
              $and: [
                { $ne: ["$dispatch.assignedDriverId", null] },
                { $ifNull: ["$dispatch.assignedDriverId", false] },
              ],
            },
          },
        },
        {
          $group: {
            _id: "$effectiveCityId",
            assignedCount: {
              $sum: { $cond: ["$hasAssignedDriver", 1, 0] },
            },
            deliveredWithDriverCount: {
              $sum: {
                $cond: [{ $and: ["$hasAssignedDriver", { $eq: ["$status", "delivered"] }] }, 1, 0],
              },
            },
            avgTimeToAcceptMins: { $avg: "$sla.firstActionMinutes" },
            avgTotalMins: {
              $avg: {
                $cond: [{ $eq: ["$status", "delivered"] }, "$sla.totalMinutes", null],
              },
            },
          },
        },
      ]),
      City.find({})
        .select("_id code slug name country")
        .lean<Array<{ _id: mongoose.Types.ObjectId; code?: string; slug?: string; name?: string; country?: string }>>(),
    ]);

    const cityMetaMap = new Map(cities.map((city) => [String(city._id), city]));
    const mapped = rows.map((row) => {
      const cityMeta = cityMetaMap.get(String(row._id));
      return {
        cityId: String(row._id),
        cityCode: cityCode({
          code: String(cityMeta?.code || (String(row._id) === String(defaultCity._id) ? defaultCity.code : "")),
        }),
        citySlug: citySlug({
          slug: String(cityMeta?.slug || (String(row._id) === String(defaultCity._id) ? defaultCity.slug : "")),
          name: String(cityMeta?.name || (String(row._id) === String(defaultCity._id) ? defaultCity.name : "")),
        }),
        cityName: String(cityMeta?.name || (String(row._id) === String(defaultCity._id) ? defaultCity.name : row._id)),
        country: String(cityMeta?.country || (String(row._id) === String(defaultCity._id) ? defaultCity.country : "")),
        assignedCount: Number(row.assignedCount || 0),
        deliveredWithDriverCount: Number(row.deliveredWithDriverCount || 0),
        avgTimeToAcceptMins: Number.isFinite(Number(row.avgTimeToAcceptMins))
          ? Number(Number(row.avgTimeToAcceptMins).toFixed(2))
          : 0,
        avgTotalMins: Number.isFinite(Number(row.avgTotalMins))
          ? Number(Number(row.avgTotalMins).toFixed(2))
          : 0,
      };
    });

    mapped.sort((a, b) => b.assignedCount - a.assignedCount);

    return ok({
      from: from.toISOString(),
      to: to.toISOString(),
      rows: mapped,
    });
  } catch (error: unknown) {
    const err = error as ApiError;
    return fail(
      err.code || "SERVER_ERROR",
      err.message || "Could not load dispatch analytics by city.",
      err.status || 500
    );
  }
}
