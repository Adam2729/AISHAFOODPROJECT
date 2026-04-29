import { NextResponse } from "next/server";
import { dbConnect } from "@/lib/mongodb";
import { requireAdminKey } from "@/lib/adminAuth";
import { assertNotInMaintenance } from "@/lib/maintenance";
import { parseWeekKeyOrThrow } from "@/lib/opsAnalytics";
import { loadBreakdownRows } from "../route";

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
    requireAdminKey(req);
    await assertNotInMaintenance();
    await dbConnect();

    const url = new URL(req.url);
    const weekKey = parseWeekKeyOrThrow(url.searchParams.get("weekKey"), new Date());
    const rows = await loadBreakdownRows(weekKey);

    const header =
      "cityCode,cityName,weekKey,ordersTotal,delivered,cancelled,commissionTotal,platformDeliveryMarginTotal,riderPayoutTotal,assignedCount,unassignedCount";

    const bodyLines = rows.map((row) =>
      [
        row.code,
        row.name,
        weekKey,
        row.ordersTotal,
        row.delivered,
        row.cancelled,
        row.commissionTotal,
        row.platformDeliveryMarginTotal,
        row.riderPayoutTotal,
        row.assignedCount,
        row.unassignedCount,
      ]
        .map(csvValue)
        .join(",")
    );

    const csv = [header, ...bodyLines].join("\n") + "\n";
    const filename = `city-breakdown_${weekKey}.csv`;

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
    return new NextResponse(err.message || "Could not export breakdown CSV.", {
      status: err.status || 500,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }
}
