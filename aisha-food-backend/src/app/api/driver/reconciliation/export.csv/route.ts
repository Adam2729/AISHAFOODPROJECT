import mongoose from "mongoose";
import { NextResponse } from "next/server";
import { dbConnect } from "@/lib/mongodb";
import { requireDriverCityContext } from "@/lib/driverContext";
import { loadReconciliationPreview } from "@/lib/driverEarnings";

type ApiError = Error & { status?: number; code?: string };

function csvValue(value: unknown) {
  const text = value == null ? "" : String(value);
  if (/[",\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

export async function GET(req: Request) {
  try {
    await dbConnect();
    const { driver, city } = await requireDriverCityContext(req);
    const url = new URL(req.url);
    const weekKey = url.searchParams.get("weekKey") || undefined;

    const preview = await loadReconciliationPreview({
      cityId: new mongoose.Types.ObjectId(String(city._id)),
      driverId: new mongoose.Types.ObjectId(String(driver._id)),
      weekKey,
    });

    const header =
      "orderNumber,deliveryFeeCharged,riderPayoutAmount,platformMargin,status,createdAt";
    const lines = preview.rows.map((row) =>
      [
        row.orderNumber,
        row.deliveryFeeCharged,
        row.riderPayoutAmount,
        row.platformMargin,
        row.status,
        row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt || "",
      ]
        .map(csvValue)
        .join(",")
    );
    const csv = [header, ...lines].join("\n") + "\n";
    const filename = `driver_reconciliation_${preview.weekKey}_${driver._id}.csv`;

    return new NextResponse(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error: unknown) {
    const err = error as ApiError;
    return new NextResponse(err.message || "Could not export reconciliation preview.", {
      status: err.status || 500,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }
}
