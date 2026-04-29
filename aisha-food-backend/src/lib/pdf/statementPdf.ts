import {
  formatStatementDateTime,
  formatStatementMoney,
  normalizeStatementCurrency,
  type StatementPack,
} from "@/lib/statementFormats";

const PAGE_WIDTH = 595;
const PAGE_HEIGHT = 842;
const MARGIN_LEFT = 40;
const START_Y = 800;
const LINE_HEIGHT = 14;
const MAX_LINES_PER_PAGE = 50;
const TABLE_DIVIDER = "-".repeat(94);

function escapePdfText(value: string) {
  return String(value || "")
    .replaceAll("\\", "\\\\")
    .replaceAll("(", "\\(")
    .replaceAll(")", "\\)");
}

function wrapText(text: string, maxChars = 95) {
  const words = String(text || "").split(/\s+/).filter(Boolean);
  if (!words.length) return [""];

  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (next.length <= maxChars) {
      current = next;
      continue;
    }
    if (current) lines.push(current);
    current = word.length <= maxChars ? word : word.slice(0, maxChars);
  }
  if (current) lines.push(current);
  return lines;
}

function buildLines(pack: StatementPack) {
  const currency = normalizeStatementCurrency(pack.currency);
  const lines: string[] = [];
  lines.push("Aisha Food - Weekly Statement");
  lines.push(`${pack.businessName} | ${pack.weekKey}`);
  lines.push(
    `Generado: ${formatStatementDateTime(pack.integrity.computedAt, currency, {
      timeZone: "UTC",
    })} UTC`
  );
  lines.push(TABLE_DIVIDER);
  lines.push("RESUMEN");
  lines.push(`Pedidos: ${pack.totals.ordersCount}`);
  lines.push(`Subtotal bruto: ${formatStatementMoney(pack.totals.grossSubtotal, currency)}`);
  lines.push(`Descuento promo: ${formatStatementMoney(pack.totals.promoDiscountTotal, currency)}`);
  lines.push(`Subtotal neto: ${formatStatementMoney(pack.totals.netSubtotal, currency)}`);
  lines.push(`Total pedidos: ${formatStatementMoney(pack.totals.orderTotal, currency)}`);
  lines.push(`Tarifa entrega: ${formatStatementMoney(pack.totals.deliveryFeeTotal, currency)}`);
  lines.push(`Comision: ${formatStatementMoney(pack.totals.commissionTotal, currency)}`);
  lines.push(
    `Neto comercio: ${formatStatementMoney(pack.totals.merchantNetAfterCommission, currency)}`
  );
  lines.push(`Payout drivers: ${formatStatementMoney(pack.totals.driverPayoutTotal, currency)}`);
  lines.push(
    `Margen entrega plataforma: ${formatStatementMoney(pack.totals.platformDeliveryMarginTotal, currency)}`
  );
  lines.push(
    `Platform-driver / Self-delivery: ${pack.totals.platformDriverOrdersCount} / ${pack.totals.selfDeliveryOrdersCount}`
  );
  lines.push(`Efectivo esperado: ${formatStatementMoney(pack.totals.cashExpected, currency)}`);
  lines.push(`Efectivo reportado: ${formatStatementMoney(pack.totals.cashReported, currency)}`);
  lines.push(`Efectivo verificado: ${formatStatementMoney(pack.totals.cashVerified, currency)}`);
  lines.push(`Varianza: ${formatStatementMoney(pack.totals.variance, currency)}`);
  lines.push(TABLE_DIVIDER);
  lines.push("PRUEBAS Y RESOLUCION");
  lines.push(`Settlement status: ${pack.settlement.status || "-"}`);
  lines.push(`Cash status: ${pack.cash.status || "-"}`);
  lines.push(`Collector: ${pack.cash.collectorName || pack.settlement.collectorName || "-"}`);
  lines.push(`Method: ${pack.cash.collectionMethod || pack.settlement.collectionMethod || "-"}`);
  lines.push(`Receipt ref: ${pack.cash.receiptRef || pack.settlement.receiptRef || "-"}`);
  lines.push(`Receipt photo: ${pack.cash.receiptPhotoUrl || pack.settlement.receiptPhotoUrl || "-"}`);
  lines.push(`Resolution status: ${pack.settlement.resolutionStatus || "-"}`);
  for (const wrapped of wrapText(`Resolution note: ${pack.settlement.resolutionNote || "-"}`)) {
    lines.push(wrapped);
  }
  lines.push(TABLE_DIVIDER);
  lines.push("ORDENES");
  lines.push(
    "OrderNumber        Mode         CreatedAt            DeliveredAt          OrderTotal   DriverPayout"
  );
  lines.push(TABLE_DIVIDER);

  for (const order of pack.orders || []) {
    const line = [
      String(order.orderNumber || "-").padEnd(18).slice(0, 18),
      String(order.deliveryMode || "self_delivery").padEnd(12).slice(0, 12),
      String(
        formatStatementDateTime(order.createdAt, currency, {
          timeZone: "UTC",
        })
      )
        .padEnd(20)
        .slice(0, 20),
      String(
        formatStatementDateTime(order.deliveredAt, currency, {
          timeZone: "UTC",
        })
      )
        .padEnd(20)
        .slice(0, 20),
      formatStatementMoney(order.orderTotal, currency).padStart(12).slice(-12),
      formatStatementMoney(order.driverPayoutAmount, currency).padStart(12).slice(-12),
    ].join(" ");
    lines.push(line);
  }
  lines.push(TABLE_DIVIDER);
  lines.push("Documento informativo (MVP).");

  while (lines.length < 120) {
    lines.push(" ");
  }
  return lines;
}

function linesToPages(lines: string[]) {
  const pages: string[][] = [];
  for (let i = 0; i < lines.length; i += MAX_LINES_PER_PAGE) {
    pages.push(lines.slice(i, i + MAX_LINES_PER_PAGE));
  }
  return pages.length ? pages : [[" "]];
}

function buildPdfBuffer(pagesLines: string[][]) {
  const objects: Array<{ id: number; body: string }> = [];
  const catalogId = 1;
  const pagesId = 2;
  const fontId = 3;
  const firstPageId = 4;

  objects.push({
    id: catalogId,
    body: `<< /Type /Catalog /Pages ${pagesId} 0 R >>`,
  });
  objects.push({
    id: fontId,
    body: `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>`,
  });

  const pageIds: number[] = [];
  for (let index = 0; index < pagesLines.length; index += 1) {
    const pageId = firstPageId + index * 2;
    const contentId = firstPageId + index * 2 + 1;
    pageIds.push(pageId);

    const commands: string[] = [];
    commands.push("BT");
    commands.push("/F1 10 Tf");
    commands.push(`${LINE_HEIGHT} TL`);
    commands.push(`1 0 0 1 ${MARGIN_LEFT} ${START_Y} Tm`);
    for (const line of pagesLines[index]) {
      commands.push(`(${escapePdfText(line)}) Tj`);
      commands.push("T*");
    }
    commands.push("ET");
    const stream = `${commands.join("\n")}\n`;

    objects.push({
      id: pageId,
      body: `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] /Resources << /Font << /F1 ${fontId} 0 R >> >> /Contents ${contentId} 0 R >>`,
    });
    objects.push({
      id: contentId,
      body: `<< /Length ${Buffer.byteLength(stream, "utf8")} >>\nstream\n${stream}endstream`,
    });
  }

  objects.splice(1, 0, {
    id: pagesId,
    body: `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageIds.length} >>`,
  });

  objects.sort((a, b) => a.id - b.id);

  let output = "%PDF-1.4\n";
  const offsets: number[] = [0];
  for (const object of objects) {
    offsets[object.id] = Buffer.byteLength(output, "utf8");
    output += `${object.id} 0 obj\n${object.body}\nendobj\n`;
  }
  const xrefOffset = Buffer.byteLength(output, "utf8");
  const maxId = objects[objects.length - 1]?.id || 0;

  output += `xref\n0 ${maxId + 1}\n`;
  output += "0000000000 65535 f \n";
  for (let id = 1; id <= maxId; id += 1) {
    const offset = offsets[id] || 0;
    output += `${String(offset).padStart(10, "0")} 00000 n \n`;
  }
  output += `trailer\n<< /Size ${maxId + 1} /Root ${catalogId} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;

  return Buffer.from(output, "utf8");
}

export async function renderStatementPdf(pack: StatementPack): Promise<Buffer> {
  const lines = buildLines(pack);
  const pages = linesToPages(lines);
  return buildPdfBuffer(pages);
}
