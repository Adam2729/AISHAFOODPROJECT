import { NextResponse } from "next/server";
import { dbConnect } from "@/lib/mongodb";
import { requireAdminKey } from "@/lib/adminAuth";
import { assertNotInMaintenance } from "@/lib/maintenance";
import { requireActiveCity, resolveCityFromRequest } from "@/lib/city";
import { parseWeekKeyOrThrow } from "@/lib/opsAnalytics";
import { loadCityWeekSummary } from "../route";

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
    const city = await resolveCityFromRequest(req);

    requireActiveCity({
      isActive: Boolean(city.isActive),
      code: String(city.code || ""),
      name: String(city.name || ""),
      country: String(city.country || ""),
    });

    const summary = await loadCityWeekSummary(city, weekKey);

    const header =
      "cityCode,cityName,weekKey,ordersTotal,delivered,cancelled,grossSubtotalTotal,commissionTotal,deliveryFeeToCustomerTotal,platformDeliveryMarginTotal,riderPayoutTotal,assignedCount,unassignedCount";

    const row = [
      summary.city.code,
      summary.city.name,
      summary.weekKey,
      summary.metrics.ordersTotal,
      summary.metrics.delivered,
      summary.metrics.cancelled,
      summary.finance.grossSubtotalTotal,
      summary.finance.commissionTotal,
      summary.finance.deliveryFeeToCustomerTotal,
      summary.finance.platformDeliveryMarginTotal,
      summary.finance.riderPayoutTotal,
      summary.dispatch.assignedCount,
      summary.dispatch.unassignedCount,
    ]
      .map(csvValue)
      .join(",");

    const csv = `${header}\n${row}\n`;
    const filename = `city-week_${summary.city.code || "city"}_${summary.weekKey}.csv`;

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
    return new NextResponse(err.message || "Could not export city-week analytics CSV.", {
      status: err.status || 500,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }
}
