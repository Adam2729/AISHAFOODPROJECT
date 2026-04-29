import mongoose from "mongoose";
import { dbConnect } from "@/lib/mongodb";
import { fail } from "@/lib/apiResponse";
import { requireAdminKey } from "@/lib/adminAuth";
import { assertNotInMaintenance } from "@/lib/maintenance";
import { csvLine } from "@/lib/csv";
import { getCityByIdOrDefault, cityCode } from "@/lib/city";
import { RiderPayout } from "@/models/RiderPayout";
import { RiderPayoutBatch } from "@/models/RiderPayoutBatch";

type ApiError = Error & { status?: number; code?: string };

const HEADER = [
  "cityCode",
  "weekKey",
  "payoutId",
  "orderId",
  "driverId",
  "driverRef",
  "businessId",
  "amount",
  "deliveryFeeCharged",
  "platformMargin",
  "status",
  "createdAt",
  "paidAt",
] as const;

export async function GET(
  req: Request,
  { params }: { params: Promise<{ batchId: string }> }
) {
  try {
    requireAdminKey(req);
    await assertNotInMaintenance();

    const { batchId } = await params;
    if (!mongoose.Types.ObjectId.isValid(batchId)) {
      return fail("VALIDATION_ERROR", "Invalid batchId.", 400);
    }

    await dbConnect();
    const batch = await RiderPayoutBatch.findById(new mongoose.Types.ObjectId(batchId)).lean<{
      _id: mongoose.Types.ObjectId;
      cityId: mongoose.Types.ObjectId;
      weekKey: string;
      status: "open" | "paid" | "void";
      payoutIds?: mongoose.Types.ObjectId[];
      payoutsCount?: number;
      totalAmount?: number;
      totalDeliveryFeeCharged?: number;
      totalPlatformMargin?: number;
      createdAt?: Date;
      updatedAt?: Date;
    } | null>();
    if (!batch) {
      return fail("NOT_FOUND", "Batch not found.", 404);
    }

    const payoutIds = Array.isArray(batch.payoutIds) ? batch.payoutIds : [];
    const rows = payoutIds.length
      ? await RiderPayout.find({ _id: { $in: payoutIds } })
          .sort({ createdAt: 1, _id: 1 })
          .select(
            "_id cityId weekKey orderId driverId driverRef businessId amount deliveryFeeCharged platformMargin status createdAt paidAt"
          )
          .lean<
            Array<{
              _id: mongoose.Types.ObjectId;
              cityId: mongoose.Types.ObjectId;
              weekKey: string;
              orderId: mongoose.Types.ObjectId;
              driverId?: mongoose.Types.ObjectId | null;
              driverRef?: string | null;
              businessId: mongoose.Types.ObjectId;
              amount: number;
              deliveryFeeCharged: number;
              platformMargin: number;
              status: "pending" | "paid" | "void";
              createdAt?: Date;
              paidAt?: Date | null;
            }>
          >()
      : [];

    const city = await getCityByIdOrDefault(batch.cityId);
    const code = cityCode(city) || "CITY";

    const lines: string[] = [];
    lines.push(`# batchId=${String(batch._id)}`);
    lines.push(`# cityId=${String(batch.cityId)}`);
    lines.push(`# weekKey=${String(batch.weekKey || "")}`);
    lines.push(`# status=${String(batch.status || "")}`);
    lines.push(`# payoutsCount=${Number(batch.payoutsCount || 0)}`);
    lines.push(`# totalAmount=${Number(batch.totalAmount || 0)}`);
    lines.push(`# totalDeliveryFeeCharged=${Number(batch.totalDeliveryFeeCharged || 0)}`);
    lines.push(`# totalPlatformMargin=${Number(batch.totalPlatformMargin || 0)}`);
    lines.push(csvLine([...HEADER]));

    for (const row of rows) {
      lines.push(
        csvLine([
          code,
          String(row.weekKey || ""),
          String(row._id),
          String(row.orderId || ""),
          row.driverId ? String(row.driverId) : "",
          String(row.driverRef || ""),
          String(row.businessId || ""),
          Number(row.amount || 0),
          Number(row.deliveryFeeCharged || 0),
          Number(row.platformMargin || 0),
          String(row.status || ""),
          row.createdAt ? new Date(row.createdAt).toISOString() : "",
          row.paidAt ? new Date(row.paidAt).toISOString() : "",
        ])
      );
    }

    const safeCode = String(code || "CITY").replace(/[^A-Z0-9_-]+/gi, "").toUpperCase() || "CITY";
    const safeWeekKey = String(batch.weekKey || "week").replace(/[^A-Za-z0-9_-]+/g, "") || "week";
    return new Response(lines.join("\n"), {
      status: 200,
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="rider-payout-batch-${safeCode}-${safeWeekKey}.csv"`,
        "cache-control": "no-store",
      },
    });
  } catch (error: unknown) {
    const err = error as ApiError;
    return fail(
      err.code || "SERVER_ERROR",
      err.message || "Could not export rider payout batch CSV.",
      err.status || 500
    );
  }
}
