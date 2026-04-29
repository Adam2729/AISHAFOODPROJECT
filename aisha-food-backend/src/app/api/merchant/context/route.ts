import mongoose from "mongoose";
import { dbConnect } from "@/lib/mongodb";
import { ok, fail } from "@/lib/apiResponse";
import { requireMerchantSession } from "@/lib/merchantAuth";
import { requireMerchantBusinessAvailable } from "@/lib/merchantBusiness";
import { getMarketConfig } from "@/lib/marketConfig";
import { Business } from "@/models/Business";
import { City } from "@/models/City";
import { Order } from "@/models/Order";

type ApiError = Error & { status?: number; code?: string };

export const dynamic = "force-dynamic";

type BusinessLean = {
  _id: mongoose.Types.ObjectId;
  name?: string;
  ownerName?: string;
  email?: string | null;
  type?: string;
  merchantType?: string;
  deliveryType?: string;
  cityId?: mongoose.Types.ObjectId | null;
  phone?: string;
  whatsapp?: string;
  isManuallyPaused?: boolean;
  busyUntil?: Date | string | null;
  hours?: { timezone?: string | null } | null;
};

type CityLean = {
  _id: mongoose.Types.ObjectId;
  code?: string;
  slug?: string;
  name?: string;
  country?: string;
  currency?: string;
  supportWhatsAppE164?: string;
  paymentMethods?: string[];
};

const ACTIVE_ORDER_STATUSES = ["new", "accepted", "preparing", "ready", "out_for_delivery"];

export async function GET(req: Request) {
  try {
    const session = requireMerchantSession(req);
    await dbConnect();
    await requireMerchantBusinessAvailable(session.businessId, { allowMustChange: true });
    const businessId = new mongoose.Types.ObjectId(session.businessId);

    const business = await Business.findById(businessId)
      .select(
        "name ownerName email type merchantType deliveryType cityId phone whatsapp isManuallyPaused busyUntil hours.timezone"
      )
      .lean<BusinessLean | null>();
    if (!business) return fail("NOT_FOUND", "Business not found.", 404);

    const city =
      business.cityId && mongoose.Types.ObjectId.isValid(String(business.cityId))
        ? await City.findById(business.cityId)
            .select("code slug name country currency supportWhatsAppE164 paymentMethods")
            .lean<CityLean | null>()
        : null;

    const market = getMarketConfig(city);
    const [openOrdersCount, preparingOrdersCount] = await Promise.all([
      Order.countDocuments({
        businessId,
        status: { $in: ACTIVE_ORDER_STATUSES },
      }),
      Order.countDocuments({
        businessId,
        status: { $in: ["accepted", "preparing", "ready"] },
      }),
    ]);

    const busyUntilRaw = business.busyUntil ? new Date(business.busyUntil) : null;
    const busyActive =
      busyUntilRaw && !Number.isNaN(busyUntilRaw.getTime()) && busyUntilRaw.getTime() > Date.now();

    return ok({
      business: {
        id: String(business._id),
        name: String(business.name || ""),
        ownerName: String(business.ownerName || ""),
        email: String(business.email || ""),
        type: String(business.type || ""),
        merchantType: String(business.merchantType || business.type || "restaurant"),
        deliveryType: String(business.deliveryType || "own_driver"),
        phone: String(business.phone || ""),
        whatsapp: String(business.whatsapp || ""),
        cityId: city ? String(city._id) : null,
        cityCode: String(city?.code || ""),
        cityName: String(city?.name || ""),
        country: String(city?.country || market.countryName),
        marketCode: market.marketCode,
        defaultLanguage: market.defaultLanguage,
        currencyCode: market.currencyCode,
        currencyDisplay: market.currencyDisplay,
        supportWhatsApp: market.supportWhatsApp,
        paymentMethods: market.paymentMethods,
        timezone: String(business.hours?.timezone || market.defaultTimezone),
        isManuallyPaused: Boolean(business.isManuallyPaused),
        busyUntil: busyActive ? busyUntilRaw?.toISOString() : null,
        portalStatus: business.isManuallyPaused ? "offline" : busyActive ? "busy" : "online",
        openOrdersCount,
        preparingOrdersCount,
      },
    });
  } catch (error: unknown) {
    const err = error as ApiError;
    return fail(
      err.code || "SERVER_ERROR",
      err.message || "Could not load merchant context.",
      err.status || 500
    );
  }
}
