/* eslint-disable @typescript-eslint/no-explicit-any */
import mongoose from "mongoose";
import { dbConnect } from "@/lib/mongodb";
import { ok, fail } from "@/lib/apiResponse";
import { assertNotInMaintenance } from "@/lib/maintenance";
import { Business } from "@/models/Business";
import { Product } from "@/models/Product";
import { Order } from "@/models/Order";
import { Complaint } from "@/models/Complaint";
import { Review } from "@/models/Review";
import { computeSubscriptionStatus } from "@/lib/subscription";
import { isBusinessOpenNow } from "@/lib/businessHours";
import { computeOrderEtaSnapshot } from "@/lib/eta";
import { computeTrustBadge } from "@/lib/trustBadge";
import { computeMenuEnhancements } from "@/lib/menuEnhancements";
import { getPublicDeliveryInfo } from "@/lib/deliveryPolicy";
import {
  buildCityScopedFilter,
  getDefaultCity,
  isBusinessWithinCityCoverage,
  isDefaultCity,
  requireActiveCity,
  resolveCityFromRequest,
} from "@/lib/city";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ businessId: string }> }
) {
  try {
    await assertNotInMaintenance();
    const selectedCity = await resolveCityFromRequest(req);
    requireActiveCity(selectedCity);
    const defaultCity = await getDefaultCity();
    const includeUnassigned = isDefaultCity(selectedCity, defaultCity._id);

    const { businessId } = await params;
    if (!mongoose.Types.ObjectId.isValid(businessId)) {
      return fail("INVALID_BUSINESS_ID", "Invalid businessId.");
    }

    await dbConnect();
    const business = await Business.findOne({
      _id: new mongoose.Types.ObjectId(businessId),
      ...buildCityScopedFilter(selectedCity._id, { includeUnassigned }),
    }).lean();
    if (!business || !business.isActive) {
      return fail("NOT_FOUND", "Business not found.", 404);
    }
    const subscription = computeSubscriptionStatus((business as any).subscription || {});
    if (subscription.status === "suspended") {
      return fail("BUSINESS_SUSPENDED", "Business is not available right now.", 403);
    }
    const businessLat = Number((business as any)?.location?.coordinates?.[1]);
    const businessLng = Number((business as any)?.location?.coordinates?.[0]);
    const inCluster = Number.isFinite(businessLat) && Number.isFinite(businessLng)
      ? isBusinessWithinCityCoverage(selectedCity, businessLat, businessLng)
      : false;
    if (!inCluster) {
      return fail("BUSINESS_OUTSIDE_CLUSTER", "Business is outside coverage cluster.", 400);
    }
    const openStatus = isBusinessOpenNow(business);
    const etaSnapshot = computeOrderEtaSnapshot((business as any).eta || null);
    const deliveryInfo = getPublicDeliveryInfo(business as { deliveryPolicy?: Record<string, unknown> });

    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const [trustOrdersAgg, trustComplaintsAgg, reviewReputationAgg] = await Promise.all([
      Order.aggregate<{
        _id: mongoose.Types.ObjectId;
        deliveredCount30d: number;
        acceptedCount30d: number;
        acceptedWithin7mCount30d: number;
      }>([
        {
          $match: {
            status: "delivered",
            businessId: new mongoose.Types.ObjectId(businessId),
            createdAt: { $gte: thirtyDaysAgo },
          },
        },
        {
          $project: {
            businessId: 1,
            acceptanceMinutes: {
              $cond: [
                {
                  $and: [
                    { $eq: [{ $type: "$statusTimestamps.acceptedAt" }, "date"] },
                    { $eq: [{ $type: "$createdAt" }, "date"] },
                  ],
                },
                {
                  $max: [
                    0,
                    {
                      $divide: [
                        { $subtract: ["$statusTimestamps.acceptedAt", "$createdAt"] },
                        60000,
                      ],
                    },
                  ],
                },
                null,
              ],
            },
          },
        },
        {
          $group: {
            _id: "$businessId",
            deliveredCount30d: { $sum: 1 },
            acceptedCount30d: {
              $sum: { $cond: [{ $ne: ["$acceptanceMinutes", null] }, 1, 0] },
            },
            acceptedWithin7mCount30d: {
              $sum: {
                $cond: [
                  {
                    $and: [
                      { $ne: ["$acceptanceMinutes", null] },
                      { $lte: ["$acceptanceMinutes", 7] },
                    ],
                  },
                  1,
                  0,
                ],
              },
            },
          },
        },
      ]),
      Complaint.aggregate<{
        _id: mongoose.Types.ObjectId;
        complaintsCount30d: number;
      }>([
        {
          $match: {
            businessId: new mongoose.Types.ObjectId(businessId),
            createdAt: { $gte: thirtyDaysAgo },
          },
        },
        {
          $group: {
            _id: "$businessId",
            complaintsCount30d: { $sum: 1 },
          },
        },
      ]),
      Review.aggregate<{
        _id: mongoose.Types.ObjectId;
        avgRating30d: number;
        reviewsCount30d: number;
      }>([
        {
          $match: {
            businessId: new mongoose.Types.ObjectId(businessId),
            isHidden: false,
            createdAt: { $gte: thirtyDaysAgo },
          },
        },
        {
          $group: {
            _id: "$businessId",
            avgRating30d: { $avg: "$rating" },
            reviewsCount30d: { $sum: 1 },
          },
        },
      ]),
    ]);

    const trustOrders = trustOrdersAgg[0];
    const trustComplaints = trustComplaintsAgg[0];
    const delivered30d = Number(trustOrders?.deliveredCount30d || 0);
    const acceptedCount30d = Number(trustOrders?.acceptedCount30d || 0);
    const acceptedWithin7mCount30d = Number(trustOrders?.acceptedWithin7mCount30d || 0);
    const acceptanceWithin7mRate30d =
      acceptedCount30d > 0 ? acceptedWithin7mCount30d / acceptedCount30d : 0;
    const complaints30d = Number(trustComplaints?.complaintsCount30d || 0);
    const reputation = reviewReputationAgg[0];
    const trust = computeTrustBadge({
      delivered30d,
      complaints30d,
      acceptanceWithin7mRate30d,
      isPaused: Boolean((business as any).paused),
      isManuallyPaused: Boolean((business as any).isManuallyPaused),
      businessTier: String((business as any)?.performance?.tier || "bronze"),
    });

    const products = await Product.find({ businessId, isAvailable: true })
      .sort({ category: 1, name: 1 })
      .lean();
    const enhancements = await computeMenuEnhancements(
      new mongoose.Types.ObjectId(businessId),
      14
    );

    return ok({
      business: {
        id: String((business as any)._id),
        name: (business as any).name,
        type: (business as any).type,
        address: (business as any).address,
        phone: (business as any).phone,
        logoUrl: (business as any).logoUrl || "",
        isOpenNow: Boolean(openStatus.open),
        closedReason: openStatus.open ? null : openStatus.reason || null,
        nextOpenText: openStatus.open ? null : openStatus.nextOpenText || null,
        eta: {
          minMins: etaSnapshot.etaMinMins,
          maxMins: etaSnapshot.etaMaxMins,
          prepMins: etaSnapshot.etaPrepMins,
          text: etaSnapshot.etaText,
        },
        delivery: {
          mode: deliveryInfo.mode,
          noteEs: deliveryInfo.publicNoteEs,
        },
        trust: {
          badge: trust.badge,
          delivered30d,
          acceptanceWithin7mRate30d: Number(acceptanceWithin7mRate30d.toFixed(2)),
          complaints30d,
        },
        reputation: {
          avgRating30d: Number(Number(reputation?.avgRating30d || 0).toFixed(2)),
          reviewsCount30d: Number(reputation?.reviewsCount30d || 0),
        },
      },
      products: products.map((p: any) => ({
        id: String(p._id),
        name: p.name,
        category: p.category,
        description: p.description,
        price: p.price,
        imageUrl: p.imageUrl,
        isAvailable: p.isAvailable,
        unavailableReason: p.unavailableReason || null,
      })),
      enhancements,
    });
  } catch {
    return fail("SERVER_ERROR", "Could not load menu.", 500);
  }
}
