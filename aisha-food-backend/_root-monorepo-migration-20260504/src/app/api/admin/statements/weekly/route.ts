import mongoose from "mongoose";
import { ok, fail } from "@/lib/apiResponse";
import { requireAdminKey } from "@/lib/adminAuth";
import { logRequest } from "@/lib/logger";
import { computeWeeklyStatementPack } from "@/lib/weeklyStatement";
import { OpsEvent } from "@/models/OpsEvent";

type ApiError = Error & { status?: number; code?: string };

const FORMAT_VALUES = new Set(["json", "csv_orders", "csv_summary"]);
const FINANCE_TYPES = [
  "FIN_MISSING_SETTLEMENT",
  "FIN_MISSING_CASH",
  "FIN_HASH_MISMATCH",
  "FIN_DIFF_OVER_THRESHOLD",
  "FIN_STALE_SUBMISSION",
] as const;

type OpsEventLean = {
  _id: mongoose.Types.ObjectId;
  type: string;
  severity?: "high" | "medium" | "low" | null;
  meta?: Record<string, unknown> | null;
  createdAt?: Date | null;
};

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
    requireAdminKey(req);
    const url = new URL(req.url);
    const weekKey = String(url.searchParams.get("weekKey") || "").trim();
    const businessId = String(url.searchParams.get("businessId") || "").trim();
    const formatRaw = String(url.searchParams.get("format") || "json").trim().toLowerCase();
    const format = FORMAT_VALUES.has(formatRaw) ? formatRaw : "json";
    const includeAnomalies =
      String(url.searchParams.get("includeAnomalies") || "").trim().toLowerCase() === "true";

    if (!weekKey) return fail("VALIDATION_ERROR", "weekKey is required.", 400);
    if (!mongoose.Types.ObjectId.isValid(businessId)) {
      return fail("VALIDATION_ERROR", "Invalid businessId.", 400);
    }

    const [pack, anomalies] = await Promise.all([
      computeWeeklyStatementPack(businessId, weekKey),
      includeAnomalies
        ? OpsEvent.find({
            businessId: new mongoose.Types.ObjectId(businessId),
            weekKey,
            type: { $in: [...FINANCE_TYPES] },
          })
            .select("_id type severity meta createdAt")
            .sort({ createdAt: -1 })
            .limit(100)
            .lean<OpsEventLean[]>()
        : Promise.resolve([] as OpsEventLean[]),
    ]);

    if (format === "csv_orders") {
      logRequest(req, {
        route: "admin.statements.weekly",
        status: 200,
        durationMs: Date.now() - startedAt,
        extra: { businessId, weekKey, format, orders: pack.orders.length },
      });
      const csv = buildOrdersCsv(pack);
      return new Response(csv, {
        status: 200,
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="admin-statement-orders-${businessId}-${weekKey}.csv"`,
          "Cache-Control": "no-store",
        },
      });
    }
    if (format === "csv_summary") {
      logRequest(req, {
        route: "admin.statements.weekly",
        status: 200,
        durationMs: Date.now() - startedAt,
        extra: { businessId, weekKey, format, orders: pack.orders.length },
      });
      const csv = buildSummaryCsv(pack);
      return new Response(csv, {
        status: 200,
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="admin-statement-summary-${businessId}-${weekKey}.csv"`,
          "Cache-Control": "no-store",
        },
      });
    }

    logRequest(req, {
      route: "admin.statements.weekly",
      status: 200,
      durationMs: Date.now() - startedAt,
      extra: {
        businessId,
        weekKey,
        orders: pack.orders.length,
        includeAnomalies,
      },
    });
    return ok({
      pack: {
        ...pack,
        ...(includeAnomalies
          ? {
              anomalies: anomalies.map((row) => ({
                id: String(row._id),
                type: row.type,
                severity: row.severity || null,
                meta: row.meta || null,
                createdAt: row.createdAt || null,
              })),
            }
          : {}),
      },
    });
  } catch (error: unknown) {
    const err = error as ApiError;
    const status = err.status || 500;
    logRequest(req, {
      route: "admin.statements.weekly",
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
