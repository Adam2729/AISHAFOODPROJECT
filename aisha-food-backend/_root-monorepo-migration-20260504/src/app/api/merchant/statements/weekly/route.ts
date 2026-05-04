import { ok, fail } from "@/lib/apiResponse";
import { requireMerchantSession } from "@/lib/merchantAuth";
import { requireMerchantBusinessAvailable } from "@/lib/merchantBusiness";
import { assertNotInMaintenance } from "@/lib/maintenance";
import { getWeekKey } from "@/lib/geo";
import { logRequest } from "@/lib/logger";
import { computeWeeklyStatementPack } from "@/lib/weeklyStatement";

type ApiError = Error & { status?: number; code?: string };

type RateBucket = {
  count: number;
  resetAt: number;
};

const RATE_LIMIT = 60;
const RATE_WINDOW_MS = 60 * 1000;
const rateBuckets = new Map<string, RateBucket>();

const FORMAT_VALUES = new Set(["json", "csv_orders", "csv_summary"]);

function consumeRateLimit(key: string) {
  const now = Date.now();
  const normalizedKey = String(key || "").trim();
  if (!normalizedKey) return { allowed: true };

  const current = rateBuckets.get(normalizedKey);
  if (!current || now >= current.resetAt) {
    rateBuckets.set(normalizedKey, {
      count: 1,
      resetAt: now + RATE_WINDOW_MS,
    });
    return { allowed: true };
  }
  current.count += 1;
  return { allowed: current.count <= RATE_LIMIT };
}

function csvEscape(value: unknown) {
  const str = String(value ?? "");
  if (!str.includes(",") && !str.includes('"') && !str.includes("\n")) return str;
  return `"${str.replaceAll('"', '""')}"`;
}

function toCsvLine(values: unknown[]) {
  return values.map(csvEscape).join(",");
}

function buildOrdersCsv(pack: Awaited<ReturnType<typeof computeWeeklyStatementPack>>) {
  const headers = [
    "weekKey",
    "businessId",
    "businessName",
    "orderId",
    "orderNumber",
    "createdAt",
    "deliveredAt",
    "subtotal",
    "discount",
    "netSubtotal",
    "commissionAmount",
    "statusLabelEs",
  ];
  const lines = [toCsvLine(headers)];
  for (const row of pack.orders) {
    lines.push(
      toCsvLine([
        pack.weekKey,
        pack.businessId,
        pack.businessName,
        row.orderId,
        row.orderNumber,
        row.createdAt || "",
        row.deliveredAt || "",
        row.subtotal,
        row.discount,
        row.netSubtotal,
        row.commissionAmount,
        row.statusLabelEs,
      ])
    );
  }
  return `${lines.join("\n")}\n`;
}

function buildSummaryCsv(pack: Awaited<ReturnType<typeof computeWeeklyStatementPack>>) {
  const headers = [
    "weekKey",
    "businessId",
    "businessName",
    "ordersCount",
    "grossSubtotal",
    "promoDiscountTotal",
    "netSubtotal",
    "commissionTotal",
    "cashExpected",
    "cashReported",
    "cashVerified",
    "variance",
    "settlementStatus",
    "settlementOrdersCount",
    "settlementGrossSubtotal",
    "settlementFeeTotal",
    "cashStatus",
    "collectorName",
    "collectionMethod",
    "receiptRef",
    "receiptPhotoUrl",
    "resolutionStatus",
    "resolutionNote",
    "settlementHash",
    "cashCollectionHash",
    "computedAt",
  ];
  const line = toCsvLine([
    pack.weekKey,
    pack.businessId,
    pack.businessName,
    pack.totals.ordersCount,
    pack.totals.grossSubtotal,
    pack.totals.promoDiscountTotal,
    pack.totals.netSubtotal,
    pack.totals.commissionTotal,
    pack.totals.cashExpected,
    pack.totals.cashReported ?? "",
    pack.totals.cashVerified ?? "",
    pack.totals.variance,
    pack.settlement.status,
    pack.settlement.ordersCount,
    pack.settlement.grossSubtotal,
    pack.settlement.feeTotal,
    pack.cash.status || "",
    pack.cash.collectorName || "",
    pack.cash.collectionMethod || "",
    pack.cash.receiptRef || "",
    pack.cash.receiptPhotoUrl || "",
    pack.settlement.resolutionStatus || "",
    pack.settlement.resolutionNote || "",
    pack.integrity.settlementHash || "",
    pack.integrity.cashCollectionHash || "",
    pack.integrity.computedAt,
  ]);
  return `${toCsvLine(headers)}\n${line}\n`;
}

export async function GET(req: Request) {
  const startedAt = Date.now();
  try {
    await assertNotInMaintenance();
    const session = requireMerchantSession(req);
    await requireMerchantBusinessAvailable(session.businessId);

    const rate = consumeRateLimit(session.businessId);
    if (!rate.allowed) {
      return fail("RATE_LIMIT", "Too many requests. Try later.", 429);
    }

    const url = new URL(req.url);
    const weekKey = String(url.searchParams.get("weekKey") || "").trim() || getWeekKey(new Date());
    const formatRaw = String(url.searchParams.get("format") || "json").trim().toLowerCase();
    const format = FORMAT_VALUES.has(formatRaw) ? formatRaw : "json";

    const pack = await computeWeeklyStatementPack(session.businessId, weekKey);

    if (format === "csv_orders") {
      logRequest(req, {
        route: "merchant.statements.weekly",
        status: 200,
        durationMs: Date.now() - startedAt,
        extra: {
          businessId: session.businessId,
          weekKey,
          format,
          orders: pack.orders.length,
        },
      });
      const csv = buildOrdersCsv(pack);
      return new Response(csv, {
        status: 200,
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="merchant-statement-orders-${weekKey}.csv"`,
          "Cache-Control": "no-store",
        },
      });
    }
    if (format === "csv_summary") {
      logRequest(req, {
        route: "merchant.statements.weekly",
        status: 200,
        durationMs: Date.now() - startedAt,
        extra: {
          businessId: session.businessId,
          weekKey,
          format,
          orders: pack.orders.length,
        },
      });
      const csv = buildSummaryCsv(pack);
      return new Response(csv, {
        status: 200,
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="merchant-statement-summary-${weekKey}.csv"`,
          "Cache-Control": "no-store",
        },
      });
    }

    logRequest(req, {
      route: "merchant.statements.weekly",
      status: 200,
      durationMs: Date.now() - startedAt,
      extra: {
        businessId: session.businessId,
        weekKey,
        orders: pack.orders.length,
      },
    });
    return ok({ pack });
  } catch (error: unknown) {
    const err = error as ApiError;
    const status = err.status || 500;
    logRequest(req, {
      route: "merchant.statements.weekly",
      status,
      durationMs: Date.now() - startedAt,
      extra: {
        message: err.message || "Could not load weekly statement.",
      },
    });
    return fail(
      err.code || "SERVER_ERROR",
      err.message || "Could not load weekly statement.",
      status
    );
  }
}
