import mongoose from "mongoose";
import { ok, fail } from "@/lib/apiResponse";
import { resolveCityFromRequest, requireActiveCity, type CityLean } from "@/lib/city";
import {
  buildRestaurantSlug,
  estimateRestaurantDeliveryMinutes,
  getRestaurantListDeliveryFee,
  parseRestaurantIdFromSlug,
} from "@/lib/customerOrdering";
import { computeOrderEtaSnapshot } from "@/lib/eta";
import { dbConnect } from "@/lib/mongodb";
import { formatProductSizeLabel } from "@/lib/productCatalog";
import { Business } from "@/models/Business";
import { Product } from "@/models/Product";

type ApiError = Error & { status?: number; code?: string };

export async function GET(
  req: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    await dbConnect();
    const selectedCity = await resolveCityFromRequest(req);
    requireActiveCity(selectedCity);

    const { slug } = await params;
    const restaurantId = parseRestaurantIdFromSlug(slug);
    if (!mongoose.Types.ObjectId.isValid(restaurantId)) {
      return fail("VALIDATION_ERROR", "Invalid restaurant slug.", 400);
    }

    const restaurant = await Business.findOne({
      _id: new mongoose.Types.ObjectId(restaurantId),
      cityId: new mongoose.Types.ObjectId(String(selectedCity._id)),
      isActive: true,
      type: "restaurant",
    })
      .select("_id cityId name phone whatsapp logoUrl zoneLabel eta")
      .lean<{
        _id: mongoose.Types.ObjectId;
        cityId?: mongoose.Types.ObjectId | null;
        name?: string;
        phone?: string;
        whatsapp?: string;
        logoUrl?: string;
        zoneLabel?: string | null;
        eta?: { minMins?: number; maxMins?: number; prepMins?: number } | null;
      } | null>();

    if (!restaurant) {
      return fail("NOT_FOUND", "Restaurant not found.", 404);
    }

    const menuItems = await Product.find({
      businessId: restaurant._id,
      isAvailable: true,
      isArchived: { $ne: true },
    })
      .select("_id name description price imageUrl category displaySize quantityValue quantityUnit")
      .sort({ category: 1, name: 1 })
      .lean<Array<{
        _id: mongoose.Types.ObjectId;
        name?: string;
        description?: string;
        price?: number;
        imageUrl?: string;
        category?: string;
        displaySize?: string;
        quantityValue?: number | null;
        quantityUnit?: string;
      }>>();

    const etaSnapshot = computeOrderEtaSnapshot(restaurant.eta || null);
    const city = selectedCity as Pick<CityLean, "deliveryFeeModel" | "deliveryFeeBands">;

    return ok({
      restaurantId: String(restaurant._id),
      name: String(restaurant.name || ""),
      slug: buildRestaurantSlug({
        restaurantId: String(restaurant._id),
        name: String(restaurant.name || ""),
      }),
      phone: String(restaurant.phone || "").trim() || null,
      whatsapp: String(restaurant.whatsapp || "").trim() || null,
      logo: String(restaurant.logoUrl || ""),
      zoneLabel: String(restaurant.zoneLabel || "").trim() || null,
      deliveryFee: getRestaurantListDeliveryFee(city),
      estimatedDeliveryMinutes: estimateRestaurantDeliveryMinutes({
        minMins: etaSnapshot.etaMinMins,
        maxMins: etaSnapshot.etaMaxMins,
      }),
      menu: menuItems.map((item) => ({
        itemId: String(item._id),
        name: String(item.name || ""),
        description: String(item.description || ""),
        price: Number(item.price || 0),
        image: String(item.imageUrl || ""),
        category: String(item.category || "").trim() || "Other",
        displaySize: formatProductSizeLabel({
          displaySize: item.displaySize,
          quantityValue: item.quantityValue,
          quantityUnit: item.quantityUnit,
        }),
        quantityValue: item.quantityValue ?? null,
        quantityUnit: String(item.quantityUnit || ""),
      })),
    });
  } catch (error: unknown) {
    const err = error as ApiError;
    return fail(
      err.code || "SERVER_ERROR",
      err.message || "Could not load restaurant menu.",
      err.status || 500
    );
  }
}
