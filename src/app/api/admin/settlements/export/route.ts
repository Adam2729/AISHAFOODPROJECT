import { dbConnect } from "@/lib/mongodb";
import { requireAdminKey } from "@/lib/adminAuth";
import { fail } from "@/lib/apiResponse";
import { getWeekKey } from "@/lib/geo";
import { Settlement } from "@/models/Settlement";

type ApiError = Error & { status?: number; code?: string };

function csvEscape(value: unknown) {
  const str = String(value ?? "");
  if (/[",\n\r]/.test(str)) return `"${str.replace(/"/g, "\"\"")}"`;
  return str;
}

export async function GET(req: Request) {
  try {
    requireAdminKey(req);
    const url = new URL(req.url);
    const weekKey = url.searchParams.get("weekKey")?.trim() || getWeekKey(new Date());

    await dbConnect();
    const rows = await Settlement.find({ weekKey }).sort({ feeTotal: -1 }).lean();

    const headers = [
      "businessId",
      "businessName",
      "weekKey",
      "status",
      "ordersCount",
      "grossSubtotal",
      "feeTotal",
      "receiptRef",
      "collectedAt",
    ];

    const lines = [
      headers.join(","),
      ...rows.map((row) =>
        [
          csvEscape(row.businessId),
          csvEscape(row.businessName),
          csvEscape(row.weekKey),
          csvEscape(row.status),
          csvEscape(Number(row.ordersCount || 0)),
          csvEscape(Number(row.grossSubtotal || 0).toFixed(2)),
          csvEscape(Number(row.feeTotal || 0).toFixed(2)),
          csvEscape(row.receiptRef || ""),
          csvEscape(row.collectedAt ? new Date(row.collectedAt).toISOString() : ""),
        ].join(",")
      ),
    ];

    return new Response(lines.join("\n"), {
      status: 200,
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename=\"settlements-${weekKey}.csv\"`,
        "cache-control": "no-store",
      },
    });
  } catch (e: unknown) {
    const err = e as ApiError;
    return fail(err.code || "SERVER_ERROR", err.message || "Could not export settlements.", err.status || 500);
  }
}
