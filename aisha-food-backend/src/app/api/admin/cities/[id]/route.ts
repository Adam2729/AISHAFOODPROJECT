import mongoose from "mongoose";
import { dbConnect } from "@/lib/mongodb";
import { ok, fail } from "@/lib/apiResponse";
import { requireAdminKey } from "@/lib/adminAuth";
import { City } from "@/models/City";

type ApiError = Error & { status?: number; code?: string };

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    requireAdminKey(req);
    const { id } = await params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return fail("VALIDATION_ERROR", "Invalid city id.", 400);
    }

    await dbConnect();
    const city = await City.findById(new mongoose.Types.ObjectId(id)).lean();
    if (!city) return fail("NOT_FOUND", "City not found.", 404);

    return ok({
      city: {
        _id: String(city._id),
        code: String(city.code || ""),
        slug: String(city.slug || ""),
        name: String(city.name || ""),
        country: String(city.country || ""),
        currency: city.currency,
        maxDeliveryRadiusKm: Number(city.maxDeliveryRadiusKm || 0),
        coverageCenterLat: Number(city.coverageCenterLat || 0),
        coverageCenterLng: Number(city.coverageCenterLng || 0),
        commissionRate: Number(city.commissionRate || 0),
        subscriptionEnabled: Boolean(city.subscriptionEnabled),
        subscriptionPrice: Number(city.subscriptionPrice || 0),
        deliveryFeeModel: city.deliveryFeeModel,
        deliveryFeeBands: Array.isArray(city.deliveryFeeBands)
          ? city.deliveryFeeBands.map((band: { minKm?: number; maxKm?: number; fee?: number }) => ({
              minKm: Number(band.minKm || 0),
              maxKm: Number(band.maxKm || 0),
              fee: Number(band.fee || 0),
            }))
          : [],
        deliveryFeeCurrency: city.deliveryFeeCurrency || city.currency,
        riderPayoutModel: city.riderPayoutModel || "none",
        riderPayoutFlat: Number(city.riderPayoutFlat || 0),
        platformDeliveryMargin: Number(city.platformDeliveryMargin || 0),
        paymentMethods: Array.isArray(city.paymentMethods) ? city.paymentMethods : [],
        riderModel: city.riderModel,
        supportWhatsAppE164: String(city.supportWhatsAppE164 || ""),
        isActive: Boolean(city.isActive),
        createdAt: city.createdAt || null,
        updatedAt: city.updatedAt || null,
      },
    });
  } catch (error: unknown) {
    const err = error as ApiError;
    return fail(
      err.code || "SERVER_ERROR",
      err.message || "Could not load city.",
      err.status || 500
    );
  }
}
