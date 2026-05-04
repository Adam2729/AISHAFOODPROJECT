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
    assignedDriverId?: mongoose.Types.ObjectId | null;
    assignedDriverName?: string | null;
    assignedAt?: Date | null;
    pickupConfirmedAt?: Date | null;
    deliveredConfirmedAt?: Date | null;
    cashCollectedByDriver?: boolean;
    handoffNote?: string | null;
  };
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
          "_id orderNumber businessName address total status eta dispatch createdAt"
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
          orderId: String(order._id),
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
            assignedDriverId: order.dispatch?.assignedDriverId
              ? String(order.dispatch.assignedDriverId)
              : null,
            assignedDriverName: order.dispatch?.assignedDriverName || null,
            assignedAt: order.dispatch?.assignedAt || null,
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
