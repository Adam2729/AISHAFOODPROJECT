import { createHash } from "node:crypto";

function stableSortValue(input: unknown): unknown {
  if (Array.isArray(input)) {
    return input.map((item) => stableSortValue(item));
  }
  if (input && typeof input === "object") {
    const source = input as Record<string, unknown>;
    const keys = Object.keys(source).sort((a, b) => a.localeCompare(b));
    const next: Record<string, unknown> = {};
    for (const key of keys) {
      next[key] = stableSortValue(source[key]);
    }
    return next;
  }
  return input;
}

export function sha256StableStringify(input: unknown): string {
  const normalized = stableSortValue(input);
  const payload = JSON.stringify(normalized);
  return createHash("sha256").update(payload).digest("hex");
}

export function computeExpectedHash(input: {
  businessId: string;
  weekKey: string;
  expected: {
    ordersCount: number;
    grossSubtotal: number;
    promoDiscountTotal: number;
    netSubtotal: number;
    commissionTotal: number;
  };
}) {
  return sha256StableStringify({
    businessId: String(input.businessId || "").trim(),
    weekKey: String(input.weekKey || "").trim(),
    expected: {
      ordersCount: Number(input.expected.ordersCount || 0),
      grossSubtotal: Number(input.expected.grossSubtotal || 0),
      promoDiscountTotal: Number(input.expected.promoDiscountTotal || 0),
      netSubtotal: Number(input.expected.netSubtotal || 0),
      commissionTotal: Number(input.expected.commissionTotal || 0),
    },
  });
}
