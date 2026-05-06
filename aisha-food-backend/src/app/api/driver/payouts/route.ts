import mongoose from "mongoose";
import { dbConnect } from "@/lib/mongodb";
import { ok, fail } from "@/lib/apiResponse";
import { requireDriverFromToken } from "@/lib/driverTokenAuth";
import { RiderPayout } from "@/models/RiderPayout";
import { DriverPayoutRequest } from "@/models/DriverPayoutRequest";
import { Order } from "@/models/Order";
import { Business } from "@/models/Business";
import { Driver } from "@/models/Driver";

type ApiError = Error & { status?: number; code?: string };

export async function GET(req: Request) {
  try {
    await dbConnect();
    const { driver, tokenCityId } = await requireDriverFromToken(req);
    const cityObjectId = new mongoose.Types.ObjectId(tokenCityId);
    const [payouts, payoutRequests, driverProfile] = await Promise.all([
      RiderPayout.find({
        driverId: driver._id,
        status: "pending",
        cityId: cityObjectId,
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
        >(),
      DriverPayoutRequest.find({
        driverId: driver._id,
        archivedAt: null,
      })
        .sort({ requestedAt: -1, createdAt: -1 })
        .limit(20)
        .lean<
          Array<{
            _id: mongoose.Types.ObjectId;
            status: string;
            requestedAmount: number;
            requestedAt?: Date;
            approvedAt?: Date | null;
            paidAt?: Date | null;
            rejectedAt?: Date | null;
            payoutMethod?: string;
            payoutAccountName?: string;
            payoutAccountNumber?: string;
            payoutReference?: string;
            adminNote?: string;
            rejectionReason?: string;
          }>
        >(),
      Driver.findById(driver._id)
        .select("payout")
        .lean<
          | {
              payout?: {
                preferredMethod?: string | null;
                accountName?: string | null;
                accountNumber?: string | null;
                notes?: string | null;
              } | null;
            }
          | null
        >(),
    ]);

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
    const payoutProfile = driverProfile?.payout || null;

    return ok({
      driver: {
        id: String(driver._id),
        name: String(driver.name || ""),
      },
      payoutProfile: payoutProfile
        ? {
            payoutMethod: String(payoutProfile.preferredMethod || "cash"),
            payoutAccountName: String(payoutProfile.accountName || ""),
            payoutAccountNumber: String(payoutProfile.accountNumber || ""),
            payoutNotes: String(payoutProfile.notes || ""),
          }
        : null,
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
      payoutRequests: payoutRequests.map((row) => ({
        id: String(row._id),
        status: String(row.status || "requested"),
        requestedAmount: Number(row.requestedAmount || 0),
        requestedAt: row.requestedAt || null,
        approvedAt: row.approvedAt || null,
        paidAt: row.paidAt || null,
        rejectedAt: row.rejectedAt || null,
        payoutMethod: String(row.payoutMethod || "cash"),
        payoutAccountName: String(row.payoutAccountName || ""),
        payoutAccountNumber: String(row.payoutAccountNumber || ""),
        payoutReference: String(row.payoutReference || ""),
        adminNote: String(row.adminNote || ""),
        rejectionReason: String(row.rejectionReason || ""),
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
