import mongoose from "mongoose";
import { dbConnect } from "@/lib/mongodb";
import { ok, fail } from "@/lib/apiResponse";
import { requireDriverFromToken } from "@/lib/driverTokenAuth";
import { Order } from "@/models/Order";

type ApiError = Error & { status?: number; code?: string };

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
  };
  dispatch?: {
    pickupConfirmedAt?: Date | null;
    deliveredConfirmedAt?: Date | null;
    cashCollectedByDriver?: boolean;
    handoffNote?: string | null;
  };
};

export async function GET(req: Request) {
  try {
    await dbConnect();
    const driver = await requireDriverFromToken(req);
    const orders = await Order.find({
      "dispatch.assignedDriverId": driver._id,
    })
      .select(
        "_id orderNumber businessName address total status eta createdAt dispatch.pickupConfirmedAt dispatch.deliveredConfirmedAt dispatch.cashCollectedByDriver dispatch.handoffNote"
      )
      .sort({ createdAt: -1 })
      .limit(50)
      .lean<OrderRow[]>();

    return ok({
      driver: {
        id: String(driver._id),
        name: String(driver.name || ""),
        zoneLabel: String(driver.zoneLabel || "").trim() || null,
      },
      orders: orders.map((order) => ({
        orderId: String(order._id),
        orderNumber: String(order.orderNumber || ""),
        businessName: String(order.businessName || ""),
        address: String(order.address || ""),
        totals: {
          total: Number(order.total || 0),
        },
        status: String(order.status || ""),
        eta: {
          text: String(order.eta?.text || ""),
        },
        createdAt: order.createdAt || null,
        dispatch: {
          pickupConfirmedAt: order.dispatch?.pickupConfirmedAt || null,
          deliveredConfirmedAt: order.dispatch?.deliveredConfirmedAt || null,
          cashCollectedByDriver: Boolean(order.dispatch?.cashCollectedByDriver),
          handoffNote: String(order.dispatch?.handoffNote || "").trim() || null,
        },
      })),
    });
  } catch (error: unknown) {
    const err = error as ApiError;
    return fail(
      err.code || "SERVER_ERROR",
      err.message || "Could not load driver orders.",
      err.status || 500
    );
  }
}
