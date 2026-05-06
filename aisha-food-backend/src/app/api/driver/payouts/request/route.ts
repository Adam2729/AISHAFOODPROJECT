import mongoose from "mongoose";
import { ok, fail } from "@/lib/apiResponse";
import { requireDriverFromToken } from "@/lib/driverTokenAuth";
import { dbConnect } from "@/lib/mongodb";
import { Driver } from "@/models/Driver";
import { DriverPayoutRequest } from "@/models/DriverPayoutRequest";
import { RiderPayout } from "@/models/RiderPayout";

type ApiError = Error & { status?: number; code?: string };

export async function POST(req: Request) {
  try {
    await dbConnect();
    const { driver, tokenCityId } = await requireDriverFromToken(req);
    const cityObjectId = new mongoose.Types.ObjectId(tokenCityId);

    const existingOpenRequest = await DriverPayoutRequest.findOne({
      driverId: driver._id,
      archivedAt: null,
      status: { $in: ["requested", "approved"] },
    })
      .select("_id status requestedAt")
      .lean();
    if (existingOpenRequest) {
      return fail("CONFLICT", "An open payout request already exists.", 409);
    }

    const payoutRows = await RiderPayout.find({
      driverId: driver._id,
      cityId: cityObjectId,
      status: "pending",
    })
      .select("_id orderId amount")
      .sort({ createdAt: 1 })
      .lean<
        Array<{
          _id: mongoose.Types.ObjectId;
          orderId: mongoose.Types.ObjectId;
          amount?: number;
        }>
      >();

    const requestedAmount = payoutRows.reduce(
      (sum, row) => sum + Number(row.amount || 0),
      0
    );
    if (!payoutRows.length || requestedAmount <= 0) {
      return fail("INVALID_STATE", "No available payout balance.", 400);
    }

    const driverProfile = await Driver.findById(driver._id)
      .select("name payout")
      .lean<
        | {
            name?: string | null;
            payout?: {
              preferredMethod?: string | null;
              accountName?: string | null;
              accountNumber?: string | null;
              notes?: string | null;
            } | null;
          }
        | null
      >();

    const requestDoc = await DriverPayoutRequest.create({
      cityId: cityObjectId,
      driverId: driver._id,
      driverName: String(driverProfile?.name || driver.name || "Driver").trim() || "Driver",
      currency: "XOF",
      requestedAmount,
      availableBalanceAtRequest: requestedAmount,
      payoutMethod: String(driverProfile?.payout?.preferredMethod || "cash").trim() || "cash",
      payoutAccountName: String(driverProfile?.payout?.accountName || "").trim(),
      payoutAccountNumber: String(driverProfile?.payout?.accountNumber || "").trim(),
      payoutNotes: String(driverProfile?.payout?.notes || "").trim(),
      status: "requested",
      orderIds: payoutRows.map((row) => row.orderId),
      riderPayoutIds: payoutRows.map((row) => row._id),
      deliveryCount: payoutRows.length,
      requestedAt: new Date(),
    });

    return ok(
      {
        requestId: String(requestDoc._id),
        status: "requested",
        requestedAmount,
        deliveryCount: payoutRows.length,
        payoutMethod: String(requestDoc.payoutMethod || "cash"),
        payoutAccountName: String(requestDoc.payoutAccountName || ""),
        payoutAccountNumber: String(requestDoc.payoutAccountNumber || ""),
      },
      201
    );
  } catch (error: unknown) {
    const err = error as ApiError;
    return fail(
      err.code || "SERVER_ERROR",
      err.message || "Could not create payout request.",
      err.status || 500
    );
  }
}
