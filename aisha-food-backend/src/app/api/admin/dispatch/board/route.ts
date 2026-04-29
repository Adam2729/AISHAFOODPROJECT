import mongoose from "mongoose";
import { dbConnect } from "@/lib/mongodb";
import { ok, fail } from "@/lib/apiResponse";
import { requireAdminKey } from "@/lib/adminAuth";
import { DISPATCH_ACTIVE_STATUSES, isDispatchLate } from "@/lib/dispatch";
import { isOrderStatus } from "@/lib/orderStatus";
import { statusProgressPct } from "@/lib/orderStatusView";
import { Driver } from "@/models/Driver";
import { Order } from "@/models/Order";

type ApiError = Error & { status?: number; code?: string };

type DriverRow = {
  _id: mongoose.Types.ObjectId;
  name: string;
  isActive: boolean;
  zoneLabel?: string;
};

type OrderRow = {
  _id: mongoose.Types.ObjectId;
  cityId?: mongoose.Types.ObjectId;
  orderNumber?: string;
  businessName?: string;
  address?: string;
  total?: number;
  status?: string;
  createdAt?: Date;
  eta?: {
    text?: string;
    maxMins?: number;
  };
  dispatch?: {
    driverDispatchStatus?: string | null;
    assignedDriverId?: mongoose.Types.ObjectId | null;
    assignedDriverName?: string | null;
    assignedAt?: Date | null;
    currentOfferDriverId?: mongoose.Types.ObjectId | null;
    offerExpiresAt?: Date | null;
    pickupConfirmedAt?: Date | null;
    deliveredConfirmedAt?: Date | null;
    cashCollectedByDriver?: boolean;
    handoffNote?: string | null;
  };
  merchantIssues?: Array<{
    issueType?: string | null;
    note?: string | null;
    createdAt?: Date | null;
  }>;
  orderEvents?: Array<{
    label?: string | null;
    detail?: string | null;
    createdAt?: Date | null;
  }>;
};

function parseStatusFilter(value: string) {
  const normalized = String(value || "").trim();
  if (!normalized || normalized === "all") return "all";
  return DISPATCH_ACTIVE_STATUSES.includes(normalized as (typeof DISPATCH_ACTIVE_STATUSES)[number])
    ? normalized
    : "all";
}

export async function GET(req: Request) {
  try {
    requireAdminKey(req);
    const url = new URL(req.url);
    const statusFilter = parseStatusFilter(url.searchParams.get("status") || "");
    const lateOnly = String(url.searchParams.get("late") || "").trim() === "1";

    await dbConnect();

    const query: Record<string, unknown> = {
      status:
        statusFilter === "all"
          ? { $in: DISPATCH_ACTIVE_STATUSES }
          : statusFilter,
    };

    const [orders, drivers] = await Promise.all([
      Order.find(query)
        .select(
          "_id cityId orderNumber businessName address total status eta dispatch createdAt merchantIssues orderEvents"
        )
        .sort({ createdAt: -1 })
        .limit(300)
        .lean<OrderRow[]>(),
      Driver.find({})
        .select("_id name isActive zoneLabel")
        .sort({ isActive: -1, name: 1, createdAt: -1 })
        .lean<DriverRow[]>(),
    ]);

    const mappedOrders = orders
      .map((order) => {
        const status = String(order.status || "").trim();
        const normalizedStatus = isOrderStatus(status) ? status : "new";
        const etaMaxMins = Number(order.eta?.maxMins || 0);
        const late = isDispatchLate({
          createdAt: order.createdAt || null,
          status: normalizedStatus,
          etaMaxMins,
        });
        return {
          latestIssue:
            Array.isArray(order.merchantIssues) && order.merchantIssues.length
              ? (() => {
                  const latest = order.merchantIssues[order.merchantIssues.length - 1];
                  return {
                    type: String(latest?.issueType || "").trim() || null,
                    note: String(latest?.note || "").trim() || null,
                    createdAt: latest?.createdAt || null,
                  };
                })()
              : null,
          latestEvent:
            Array.isArray(order.orderEvents) && order.orderEvents.length
              ? (() => {
                  const latest = order.orderEvents[order.orderEvents.length - 1];
                  return {
                    label: String(latest?.label || "").trim() || null,
                    detail: String(latest?.detail || "").trim() || null,
                    createdAt: latest?.createdAt || null,
                  };
                })()
              : null,
          orderId: String(order._id),
          cityId: order.cityId ? String(order.cityId) : null,
          orderNumber: String(order.orderNumber || ""),
          businessName: String(order.businessName || ""),
          address: String(order.address || ""),
          total: Number(order.total || 0),
          status: normalizedStatus,
          statusProgressPct: statusProgressPct(normalizedStatus),
          createdAt: order.createdAt || null,
          eta: {
            text: String(order.eta?.text || ""),
            maxMins: etaMaxMins || null,
          },
          dispatch: {
            driverDispatchStatus:
              String(order.dispatch?.driverDispatchStatus || "").trim() || null,
            assignedDriverId: order.dispatch?.assignedDriverId
              ? String(order.dispatch.assignedDriverId)
              : null,
            assignedDriverName: order.dispatch?.assignedDriverName || null,
            assignedAt: order.dispatch?.assignedAt || null,
            currentOfferDriverId: order.dispatch?.currentOfferDriverId
              ? String(order.dispatch.currentOfferDriverId)
              : null,
            offerExpiresAt: order.dispatch?.offerExpiresAt || null,
            pickupConfirmedAt: order.dispatch?.pickupConfirmedAt || null,
            deliveredConfirmedAt: order.dispatch?.deliveredConfirmedAt || null,
            cashCollectedByDriver: Boolean(order.dispatch?.cashCollectedByDriver),
            handoffNote: String(order.dispatch?.handoffNote || "").trim() || null,
          },
          late,
        };
      })
      .filter((row) => (lateOnly ? row.late : true));

    return ok({
      filters: {
        status: statusFilter,
        lateOnly,
      },
      drivers: drivers.map((driver) => ({
        id: String(driver._id),
        name: String(driver.name || ""),
        isActive: Boolean(driver.isActive),
        zoneLabel: String(driver.zoneLabel || "").trim() || null,
      })),
      orders: mappedOrders,
    });
  } catch (error: unknown) {
    const err = error as ApiError;
    return fail(
      err.code || "SERVER_ERROR",
      err.message || "Could not load dispatch board.",
      err.status || 500
    );
  }
}
