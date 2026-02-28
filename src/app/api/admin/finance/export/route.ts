import { requireAdminKey } from "@/lib/adminAuth";
import { fail } from "@/lib/apiResponse";
import { logRequest } from "@/lib/logger";
import { computeFinanceAlignmentForWeek } from "@/lib/financeAlignment";

type ApiError = Error & { status?: number; code?: string };

const CSV_HEADERS = [
  "weekKey",
  "businessId",
  "businessName",
  "deliveredOrdersCount",
  "deliveredGrossSubtotal",
  "deliveredNetSubtotal",
  "deliveredCommissionTotal",
  "settlementOrdersCount",
  "settlementGrossSubtotal",
  "settlementFeeTotal",
  "settlementStatus",
  "cashStatus",
  "cashReportedGross",
  "cashReportedNet",
  "cashReportedCommission",
  "cashIntegrityStatus",
  "diffOrders",
  "diffGrossSubtotal",
  "diffFeeTotal",
  "diffCashNetVsDeliveredNet",
  "diffCashCommissionVsDeliveredCommission",
  "flags",
] as const;

function csvEscape(value: unknown) {
  const str = String(value ?? "");
  if (!str.includes(",") && !str.includes('"') && !str.includes("\n")) return str;
  return `"${str.replaceAll('"', '""')}"`;
}

function toCsvLine(values: unknown[]) {
  return values.map(csvEscape).join(",");
}

export async function GET(req: Request) {
  const startedAt = Date.now();
  try {
    requireAdminKey(req);
    const url = new URL(req.url);
    const weekKey = String(url.searchParams.get("weekKey") || "").trim();
    const onlyProblems = String(url.searchParams.get("onlyProblems") || "").trim() === "true";

    if (!weekKey) {
      return fail("VALIDATION_ERROR", "weekKey is required.", 400);
    }

    const alignment = await computeFinanceAlignmentForWeek(weekKey, { limit: 5000 });
    const filteredRows = onlyProblems
      ? alignment.rows.filter(
          (row) =>
            row.flags.missingSettlement ||
            row.flags.missingCashCollection ||
            row.flags.settlementCollectedButNoCash ||
            row.flags.hashMismatch ||
            row.flags.integrityMismatch ||
            row.flags.diffOverThreshold
        )
      : alignment.rows;

    const csvRows: string[] = [toCsvLine([...CSV_HEADERS])];
    for (const row of filteredRows) {
      const flags = Object.entries(row.flags)
        .filter(([, value]) => Boolean(value))
        .map(([name]) => name)
        .join("|");

      csvRows.push(
        toCsvLine([
          row.weekKey,
          row.businessId,
          row.businessName,
          row.deliveredAgg.deliveredOrdersCount,
          row.deliveredAgg.deliveredGrossSubtotal,
          row.deliveredAgg.deliveredNetSubtotal,
          row.deliveredAgg.deliveredCommissionTotal,
          row.settlement?.settlementOrdersCount ?? "",
          row.settlement?.settlementGrossSubtotal ?? "",
          row.settlement?.settlementFeeTotal ?? "",
          row.settlement?.settlementStatus ?? "",
          row.cash?.cashStatus ?? "",
          row.cash?.reportedGross ?? "",
          row.cash?.reportedNet ?? "",
          row.cash?.reportedCommission ?? "",
          row.cash?.integrityStatus ?? "",
          row.diffs.diffOrders ?? "",
          row.diffs.diffGrossSubtotal ?? "",
          row.diffs.diffFeeTotal ?? "",
          row.diffs.diffCashNetVsDeliveredNet ?? "",
          row.diffs.diffCashCommissionVsDeliveredCommission ?? "",
          flags,
        ])
      );
    }

    const csv = `${csvRows.join("\n")}\n`;
    const fileName = onlyProblems
      ? `finance-mismatches-${weekKey}.csv`
      : `finance-export-${weekKey}.csv`;

    logRequest(req, {
      route: "admin.finance.export",
      status: 200,
      durationMs: Date.now() - startedAt,
      extra: {
        weekKey,
        onlyProblems,
        rows: filteredRows.length,
      },
    });

    return new Response(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${fileName}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error: unknown) {
    const err = error as ApiError;
    const status = err.status || 500;
    logRequest(req, {
      route: "admin.finance.export",
      status,
      durationMs: Date.now() - startedAt,
      extra: {
        message: err.message || "Could not export finance CSV.",
      },
    });
    return fail(
      err.code || "SERVER_ERROR",
      err.message || "Could not export finance CSV.",
      status
    );
  }
}
