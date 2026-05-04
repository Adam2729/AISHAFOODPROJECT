export type StatementOrderRow = {
  orderId: string;
  orderNumber: string;
  createdAt: string | null;
  deliveredAt: string | null;
  subtotal: number;
  discount: number;
  netSubtotal: number;
  commissionAmount: number;
  statusLabelEs: string;
};

export type StatementPack = {
  businessId: string;
  businessName: string;
  weekKey: string;
  currency?: "DOP" | "CFA";
  settlement: {
    status: string | null;
    ordersCount: number;
    grossSubtotal: number;
    feeTotal: number;
    collectedAt: string | null;
    receiptRef: string | null;
    receiptPhotoUrl: string | null;
    collectorName: string | null;
    collectionMethod: string | null;
    resolutionStatus: string | null;
    resolutionNote: string | null;
    resolutionAttachmentUrl?: string | null;
    resolvedAt?: string | null;
    resolvedBy?: string | null;
  };
  cash: {
    status: string | null;
    reportedCashTotal: number | null;
    verifiedCashTotal: number | null;
    expectedCashTotal: number;
    variance: number;
    lastSubmittedAt: string | null;
    verifiedAt: string | null;
    collectorName: string | null;
    collectionMethod: string | null;
    receiptRef: string | null;
    receiptPhotoUrl: string | null;
  };
  promos: {
    promoOrdersCount: number;
    promoDiscountTotal: number;
  };
  totals: {
    ordersCount: number;
    grossSubtotal: number;
    promoDiscountTotal: number;
    netSubtotal: number;
    commissionTotal: number;
    cashExpected: number;
    cashReported: number | null;
    cashVerified: number | null;
    variance: number;
  };
  orders: StatementOrderRow[];
  integrity: {
    settlementHash: string | null;
    cashCollectionHash: string | null;
    computedAt: string;
  };
};

function csvEscape(value: unknown) {
  const str = String(value ?? "");
  if (!str.includes(",") && !str.includes('"') && !str.includes("\n")) return str;
  return `"${str.replaceAll('"', '""')}"`;
}

function toCsvLine(values: unknown[]) {
  return values.map(csvEscape).join(",");
}

function formatMoney(value: number, currency: "DOP" | "CFA") {
  const amount = Number(value || 0).toFixed(2);
  return currency === "CFA" ? `CFA ${amount}` : `RD$ ${amount}`;
}

export function buildOrdersCsv(pack: StatementPack) {
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
  for (const row of pack.orders || []) {
    lines.push(
      toCsvLine([
        pack.weekKey,
        pack.businessId,
        pack.businessName,
        row.orderId,
        row.orderNumber,
        row.createdAt || "",
        row.deliveredAt || "",
        Number(row.subtotal || 0),
        Number(row.discount || 0),
        Number(row.netSubtotal || 0),
        Number(row.commissionAmount || 0),
        row.statusLabelEs || "",
      ])
    );
  }
  return `${lines.join("\n")}\n`;
}

export function buildSummaryCsv(pack: StatementPack) {
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
    Number(pack.totals.ordersCount || 0),
    Number(pack.totals.grossSubtotal || 0),
    Number(pack.totals.promoDiscountTotal || 0),
    Number(pack.totals.netSubtotal || 0),
    Number(pack.totals.commissionTotal || 0),
    Number(pack.totals.cashExpected || 0),
    pack.totals.cashReported == null ? "" : Number(pack.totals.cashReported),
    pack.totals.cashVerified == null ? "" : Number(pack.totals.cashVerified),
    Number(pack.totals.variance || 0),
    pack.settlement.status || "",
    Number(pack.settlement.ordersCount || 0),
    Number(pack.settlement.grossSubtotal || 0),
    Number(pack.settlement.feeTotal || 0),
    pack.cash.status || "",
    pack.cash.collectorName || "",
    pack.cash.collectionMethod || "",
    pack.cash.receiptRef || "",
    pack.cash.receiptPhotoUrl || "",
    pack.settlement.resolutionStatus || "",
    pack.settlement.resolutionNote || "",
    pack.integrity.settlementHash || "",
    pack.integrity.cashCollectionHash || "",
    pack.integrity.computedAt || "",
  ]);

  return `${toCsvLine(headers)}\n${line}\n`;
}

export function buildStatementSummaryEs(pack: StatementPack) {
  const currency = pack.currency === "CFA" ? "CFA" : "DOP";
  return [
    `Resumen semanal ${pack.weekKey} - ${pack.businessName}`,
    `Pedidos: ${Number(pack.totals.ordersCount || 0)}`,
    `Subtotal bruto: ${formatMoney(Number(pack.totals.grossSubtotal || 0), currency)}`,
    `Descuento promo: ${formatMoney(Number(pack.totals.promoDiscountTotal || 0), currency)}`,
    `Subtotal neto: ${formatMoney(Number(pack.totals.netSubtotal || 0), currency)}`,
    `Comision: ${formatMoney(Number(pack.totals.commissionTotal || 0), currency)}`,
    `Efectivo esperado: ${formatMoney(Number(pack.totals.cashExpected || 0), currency)}`,
    `Efectivo reportado: ${formatMoney(Number(pack.totals.cashReported || 0), currency)}`,
    `Efectivo verificado: ${formatMoney(Number(pack.totals.cashVerified || 0), currency)}`,
    `Varianza: ${formatMoney(Number(pack.totals.variance || 0), currency)}`,
    `Estado settlement: ${pack.settlement.status || "-"}`,
    `Estado cash: ${pack.cash.status || "-"}`,
  ].join("\n");
}
