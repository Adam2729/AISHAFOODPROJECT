import mongoose from "mongoose";
import { dbConnect } from "@/lib/mongodb";
import { ok, fail } from "@/lib/apiResponse";
import { requireAdminKey } from "@/lib/adminAuth";
import { assertNotInMaintenance } from "@/lib/maintenance";
import { cityCode, requireActiveCity, resolveCityFromRequest } from "@/lib/city";
import {
  buildOrderRangeMatch,
  buildRiderPayoutRangeMatch,
  resolveRangeFromQuery,
} from "@/lib/opsAnalytics";
import { Order } from "@/models/Order";
import { RiderPayout } from "@/models/RiderPayout";

type ApiError = Error & { status?: number; code?: string };

function toNumber(value: unknown) {
  const num = Number(value || 0);
  return Number.isFinite(num) ? num : 0;
}

export async function GET(req: Request) {
  try {
    requireAdminKey(req);
    await assertNotInMaintenance();
    await dbConnect();

    const selectedCity = await resolveCityFromRequest(req);
    requireActiveCity({
      isActive: Boolean(selectedCity.isActive),
      code: String(selectedCity.code || ""),
      name: String(selectedCity.name || ""),
      country: String(selectedCity.country || ""),
    });

    const url = new URL(req.url);
    const range = resolveRangeFromQuery(url);
    const cityObjectId = new mongoose.Types.ObjectId(String(selectedCity._id));

    const [ordersAgg, payoutsAgg] = await Promise.all([
      Order.aggregate<{
        grossSubtotal: number;
        commissionTotal: number;
        deliveryFeesChargedToCustomers: number;
      }>([
        {
          $match: {
            cityId: cityObjectId,
            ...buildOrderRangeMatch(range),
          },
        },
        {
          $group: {
            _id: null,
            grossSubtotal: { $sum: "$subtotal" },
            commissionTotal: { $sum: "$commissionAmount" },
            deliveryFeesChargedToCustomers: { $sum: "$deliveryFeeToCustomer" },
          },
        },
      ]),
      RiderPayout.aggregate<{
        riderPayoutTotal: number;
        platformDeliveryMarginTotal: number;
      }>([
        {
          $match: {
            cityId: cityObjectId,
            ...buildRiderPayoutRangeMatch(range),
            status: { $ne: "void" },
          },
        },
        {
          $group: {
            _id: null,
            riderPayoutTotal: { $sum: "$amount" },
            platformDeliveryMarginTotal: { $sum: "$platformMargin" },
          },
        },
      ]),
    ]);

    const grossSubtotal = toNumber(ordersAgg[0]?.grossSubtotal);
    const commissionTotal = toNumber(ordersAgg[0]?.commissionTotal);
    const deliveryFeesChargedToCustomers = toNumber(
      ordersAgg[0]?.deliveryFeesChargedToCustomers
    );
    const riderPayoutTotal = toNumber(payoutsAgg[0]?.riderPayoutTotal);
    const platformDeliveryMarginTotal = toNumber(payoutsAgg[0]?.platformDeliveryMarginTotal);
    const netPlatformTakeApprox = commissionTotal + platformDeliveryMarginTotal;

    return ok({
      cityId: String(selectedCity._id),
      cityCode: cityCode(selectedCity),
      weekKey: range.weekKey,
      range: {
        fromIso: range.fromIso,
        toIso: range.toIso,
        mode: range.mode,
      },
      finance: {
        grossSubtotal,
        commissionTotal,
        deliveryFeesChargedToCustomers,
        riderPayoutTotal,
        platformDeliveryMarginTotal,
        netPlatformTakeApprox,
      },
    });
  } catch (error: unknown) {
    const err = error as ApiError;
    return fail(
      err.code || "SERVER_ERROR",
      err.message || "Could not load city finance analytics.",
      err.status || 500
    );
  }
}
