import mongoose from "mongoose";
import { ok, fail } from "@/lib/apiResponse";
import { requireAdminKey } from "@/lib/adminAuth";
import { cityCode } from "@/lib/city";
import { parseIntegerParam, resolveDispatchSelectedCity } from "@/lib/dispatchControl";
import { resolveOperationalOrderDeliveryMode } from "@/lib/deliveryPolicy";
import { assertNotInMaintenance } from "@/lib/maintenance";
import { dbConnect } from "@/lib/mongodb";
import { estimateDispatchEtaMinutes, pickBestDriverForOrder } from "@/lib/smartDispatch";
import { Business } from "@/models/Business";
import { Order } from "@/models/Order";

type ApiError = Error & { status?: number; code?: string };

type QueueOrder = {
  _id: mongoose.Types.ObjectId;
  businessId?: mongoose.Types.ObjectId | null;
  orderNumber?: string;
  businessName?: string;
  status?: "accepted" | "preparing" | "ready";
  createdAt?: Date | null;
  address?: string;
  deliverySnapshot?: {
    mode?: string | null;
  } | null;
  merchantDelivery?: {
    assignedAt?: Date | null;
    riderName?: string | null;
    riderPhone?: string | null;
  } | null;
};

export async function GET(req: Request) {
  try {
    requireAdminKey(req);
    await assertNotInMaintenance();

    const url = new URL(req.url);
    const selectedCity = await resolveDispatchSelectedCity(req, url.searchParams.get("cityId"));
    const limit = parseIntegerParam(url.searchParams.get("limit"), {
      defaultValue: 20,
      min: 1,
      max: 50,
      label: "limit",
    });

    await dbConnect();

    const cityObjectId = new mongoose.Types.ObjectId(String(selectedCity._id));
    const filter = {
      cityId: cityObjectId,
      status: { $in: ["accepted", "preparing", "ready"] },
      "dispatch.assignedDriverId": null,
    };

    const orders = await Order.find(filter)
      .select(
        "_id businessId orderNumber businessName status createdAt address deliverySnapshot.mode merchantDelivery.assignedAt merchantDelivery.riderName merchantDelivery.riderPhone"
      )
      .lean<QueueOrder[]>();

    const businessIds = Array.from(
      new Set(
        orders
          .map((row) => (row.businessId ? String(row.businessId) : ""))
          .filter(Boolean)
      )
    ).map((value) => new mongoose.Types.ObjectId(value));

    const businesses = businessIds.length
      ? await Business.find({ _id: { $in: businessIds } })
          .select("_id zoneLabel deliveryType")
          .lean<{
            _id: mongoose.Types.ObjectId;
            zoneLabel?: string | null;
            deliveryType?: string | null;
          }[]>()
      : [];

    const businessById = new Map(
      businesses.map((row) => [
        String(row._id),
        {
          zoneLabel: String(row.zoneLabel || "").trim() || null,
          deliveryType: String(row.deliveryType || "").trim() || null,
        },
      ])
    );

    const dispatchManagedOrders = orders.filter((order) => {
      const business = businessById.get(String(order.businessId || "")) || null;
      return resolveOperationalOrderDeliveryMode(order, business) === "platform_driver";
    });

    const orderedRows = [...dispatchManagedOrders].sort((left, right) => {
      const leftPriority = left.status === "ready" ? 0 : 1;
      const rightPriority = right.status === "ready" ? 0 : 1;
      if (leftPriority !== rightPriority) return leftPriority - rightPriority;

      const leftTime = left.createdAt ? new Date(left.createdAt).getTime() : 0;
      const rightTime = right.createdAt ? new Date(right.createdAt).getTime() : 0;
      return leftTime - rightTime;
    }).slice(0, limit);

    const rows = await Promise.all(
      orderedRows.map(async (order) => {
        const business = businessById.get(String(order.businessId || "")) || null;
        const zoneLabel = business?.zoneLabel || null;
        const { bestDriver, ranked } = await pickBestDriverForOrder({
          cityId: cityObjectId,
          order: {
            _id: order._id,
            businessId: order.businessId || null,
            businessZoneLabel: zoneLabel,
          },
        });

        const selectedRank = ranked[0] || null;
        const suggestedEtaMinutes = selectedRank
          ? estimateDispatchEtaMinutes({
              activeLoad: selectedRank.activeLoad,
              sameZone: selectedRank.sameZone,
            })
          : null;

        return {
          orderId: String(order._id),
          orderNumber: String(order.orderNumber || ""),
          businessName: String(order.businessName || ""),
          status: String(order.status || ""),
          createdAt: order.createdAt || null,
          address: String(order.address || ""),
          zoneLabel,
          suggestedDriverId: bestDriver ? String(bestDriver._id) : null,
          suggestedScore: selectedRank ? selectedRank.score : null,
          suggestedEtaMinutes,
        };
      })
    );

    return ok({
      cityId: String(selectedCity._id),
      cityCode: cityCode(selectedCity),
      total: dispatchManagedOrders.length,
      rows,
    });
  } catch (error: unknown) {
    const err = error as ApiError;
    return fail(
      err.code || "SERVER_ERROR",
      err.message || "Could not load auto-assign queue.",
      err.status || 500
    );
  }
}
