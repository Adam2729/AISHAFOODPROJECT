import mongoose from "mongoose";
import { dbConnect } from "@/lib/mongodb";
import { ok, fail } from "@/lib/apiResponse";
import { requireDriverFromToken } from "@/lib/driverTokenAuth";
import { RiderPayout } from "@/models/RiderPayout";
import { Order } from "@/models/Order";
import { Business } from "@/models/Business";

type ApiError = Error & { status?: number; code?: string };

export async function GET(req: Request) {
  try {
    await dbConnect();
    const driver = await requireDriverFromToken(req);
    const payouts = await RiderPayout.find({
      driverId: driver._id,
      status: "pending",
    })
      .sort({ createdAt: -1 })
      .limit(200)
      .lean<
        Array<{
          _id: mongoose.Types.ObjectId;
          orderId: mongoose.Types.ObjectId;
          businessId: mongoose.Types.ObjectId;
          cityId: mongoose.Types.ObjectId;
          weekKey: string;
          amount: number;
          deliveryFeeCharged: number;
          platformMargin: number;
          status: "pending" | "paid" | "void";
          createdAt?: Date;
        }>
      >();

    const orderIds = payouts.map((row) => row.orderId);
    const businessIds = payouts.map((row) => row.businessId);
    const [orders, businesses] = await Promise.all([
      Order.find({ _id: { $in: orderIds } })
        .select("_id orderNumber")
        .lean<Array<{ _id: mongoose.Types.ObjectId; orderNumber?: string }>>(),
      Business.find({ _id: { $in: businessIds } })
        .select("_id name")
        .lean<Array<{ _id: mongoose.Types.ObjectId; name?: string }>>(),
    ]);

    const orderMap = new Map(orders.map((row) => [String(row._id), row]));
    const businessMap = new Map(businesses.map((row) => [String(row._id), row]));

    return ok({
      driver: {
        id: String(driver._id),
        name: String(driver.name || ""),
      },
      payouts: payouts.map((row) => ({
        id: String(row._id),
        cityId: String(row.cityId),
        orderId: String(row.orderId),
        orderNumber: String(orderMap.get(String(row.orderId))?.orderNumber || ""),
        businessId: String(row.businessId),
        businessName: String(businessMap.get(String(row.businessId))?.name || ""),
        weekKey: String(row.weekKey || ""),
        amount: Number(row.amount || 0),
        deliveryFeeCharged: Number(row.deliveryFeeCharged || 0),
        platformMargin: Number(row.platformMargin || 0),
        status: row.status,
        createdAt: row.createdAt || null,
      })),
    });
  } catch (error: unknown) {
    const err = error as ApiError;
    return fail(
      err.code || "SERVER_ERROR",
      err.message || "Could not load driver payouts.",
      err.status || 500
    );
  }
}

