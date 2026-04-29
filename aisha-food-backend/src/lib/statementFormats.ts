export type StatementCurrency = "DOP" | "XOF";

export type StatementOrderRow = {
  orderId: string;
  orderNumber: string;
  createdAt: string | null;
  deliveredAt: string | null;
  subtotal: number;
  discount: number;
  netSubtotal: number;
  orderTotal: number;
  deliveryFee: number;
  deliveryMode: "self_delivery" | "platform_driver";
  driverPayoutAmount: number;
  platformDeliveryMargin: number;
  commissionAmount: number;
  statusLabelEs: string;
};

export type StatementPack = {
  businessId: string;
  businessName: string;
  weekKey: string;
  currency?: StatementCurrency;
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
    driverCash: {
      driverCollectedTotal: number;
      driverHandedTotal: number;
      driverDisputedTotal: number;
      merchantCashReceivedTotal: number;
      mismatchSignal: boolean;
    };
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
    orderTotal: number;
    deliveryFeeTotal: number;
    commissionTotal: number;
    merchantNetAfterCommission: number;
    platformDriverOrdersCount: number;
    selfDeliveryOrdersCount: number;
    platformDriverDeliveryFeeTotal: number;
    selfDeliveryDeliveryFeeTotal: number;
    driverPayoutTotal: number;
    platformDeliveryMarginTotal: number;
    cashExpected: number;
    cashReported: number | null;
    cashVerified: number | null;
    variance: number;
    driverCashCollectedTotal: number;
    driverCashHandedTotal: number;
    driverCashDisputedTotal: number;
    merchantCashReceivedTotal: number;
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

export function normalizeStatementCurrency(value: unknown): StatementCurrency {
  const normalized = String(value || "").trim().toUpperCase();
  return normalized === "XOF" || normalized === "CFA" || normalized === "FCFA" ? "XOF" : "DOP";
}

export function getStatementLocale(currency: unknown) {
  return normalizeStatementCurrency(currency) === "XOF" ? "fr-ML" : "es-DO";
}

export function formatStatementMoney(value: number | null | undefined, currency: unknown) {
  const normalizedCurrency = normalizeStatementCurrency(currency);
  const safeValue = Number.isFinite(Number(value)) ? Number(value) : 0;
  const fractionDigits = normalizedCurrency === "XOF" ? 0 : 2;
  return new Intl.NumberFormat(getStatementLocale(normalizedCurrency), {
    style: "currency",
    currency: normalizedCurrency,
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(safeValue);
}

export function formatStatementDateTime(
  value: string | null | undefined,
  currency: unknown,
  options?: Intl.DateTimeFormatOptions
) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat(getStatementLocale(currency), {
    dateStyle: "short",
    timeStyle: "short",
    ...(options || {}),
  }).format(date);
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
    "deliveryMode",
    "subtotal",
    "discount",
    "netSubtotal",
    "orderTotal",
    "deliveryFee",
    "driverPayoutAmount",
    "platformDeliveryMargin",
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
        row.deliveryMode || "self_delivery",
        Number(row.subtotal || 0),
        Number(row.discount || 0),
        Number(row.netSubtotal || 0),
        Number(row.orderTotal || 0),
        Number(row.deliveryFee || 0),
        Number(row.driverPayoutAmount || 0),
        Number(row.platformDeliveryMargin || 0),
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
    "currency",
    "ordersCount",
    "grossSubtotal",
    "promoDiscountTotal",
    "netSubtotal",
    "orderTotal",
    "deliveryFeeTotal",
    "commissionTotal",
    "merchantNetAfterCommission",
    "platformDriverOrdersCount",
    "selfDeliveryOrdersCount",
    "platformDriverDeliveryFeeTotal",
    "selfDeliveryDeliveryFeeTotal",
    "driverPayoutTotal",
    "platformDeliveryMarginTotal",
    "cashExpected",
    "cashReported",
    "cashVerified",
    "variance",
    "driverCashCollectedTotal",
    "driverCashHandedTotal",
    "driverCashDisputedTotal",
    "merchantCashReceivedTotal",
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
    normalizeStatementCurrency(pack.currency),
    Number(pack.totals.ordersCount || 0),
    Number(pack.totals.grossSubtotal || 0),
    Number(pack.totals.promoDiscountTotal || 0),
    Number(pack.totals.netSubtotal || 0),
    Number(pack.totals.orderTotal || 0),
    Number(pack.totals.deliveryFeeTotal || 0),
    Number(pack.totals.commissionTotal || 0),
    Number(pack.totals.merchantNetAfterCommission || 0),
    Number(pack.totals.platformDriverOrdersCount || 0),
    Number(pack.totals.selfDeliveryOrdersCount || 0),
    Number(pack.totals.platformDriverDeliveryFeeTotal || 0),
    Number(pack.totals.selfDeliveryDeliveryFeeTotal || 0),
    Number(pack.totals.driverPayoutTotal || 0),
    Number(pack.totals.platformDeliveryMarginTotal || 0),
    Number(pack.totals.cashExpected || 0),
    pack.totals.cashReported == null ? "" : Number(pack.totals.cashReported),
    pack.totals.cashVerified == null ? "" : Number(pack.totals.cashVerified),
    Number(pack.totals.variance || 0),
    Number(pack.totals.driverCashCollectedTotal || 0),
    Number(pack.totals.driverCashHandedTotal || 0),
    Number(pack.totals.driverCashDisputedTotal || 0),
    Number(pack.totals.merchantCashReceivedTotal || 0),
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
  const currency = normalizeStatementCurrency(pack.currency);
  return [
    `Resumen semanal ${pack.weekKey} - ${pack.businessName}`,
    `Pedidos: ${Number(pack.totals.ordersCount || 0)}`,
    `Subtotal bruto: ${formatStatementMoney(Number(pack.totals.grossSubtotal || 0), currency)}`,
    `Descuento promo: ${formatStatementMoney(Number(pack.totals.promoDiscountTotal || 0), currency)}`,
    `Subtotal neto: ${formatStatementMoney(Number(pack.totals.netSubtotal || 0), currency)}`,
    `Total pedidos: ${formatStatementMoney(Number(pack.totals.orderTotal || 0), currency)}`,
    `Tarifa entrega: ${formatStatementMoney(Number(pack.totals.deliveryFeeTotal || 0), currency)}`,
    `Comision: ${formatStatementMoney(Number(pack.totals.commissionTotal || 0), currency)}`,
    `Neto comercio: ${formatStatementMoney(Number(pack.totals.merchantNetAfterCommission || 0), currency)}`,
    `Payout drivers: ${formatStatementMoney(Number(pack.totals.driverPayoutTotal || 0), currency)}`,
    `Margen entrega plataforma: ${formatStatementMoney(
      Number(pack.totals.platformDeliveryMarginTotal || 0),
      currency
    )}`,
    `Platform-driver: ${Number(pack.totals.platformDriverOrdersCount || 0)} | Self-delivery: ${Number(
      pack.totals.selfDeliveryOrdersCount || 0
    )}`,
    `Efectivo esperado: ${formatStatementMoney(Number(pack.totals.cashExpected || 0), currency)}`,
    `Efectivo reportado: ${formatStatementMoney(Number(pack.totals.cashReported || 0), currency)}`,
    `Efectivo verificado: ${formatStatementMoney(Number(pack.totals.cashVerified || 0), currency)}`,
    `Varianza: ${formatStatementMoney(Number(pack.totals.variance || 0), currency)}`,
    `Estado settlement: ${pack.settlement.status || "-"}`,
    `Estado cash: ${pack.cash.status || "-"}`,
  ].join("\n");
}
