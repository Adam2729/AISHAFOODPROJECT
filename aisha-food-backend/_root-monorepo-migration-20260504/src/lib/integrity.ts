import crypto from "crypto";

type SettlementHashInput = {
  businessId: string;
  weekKey: string;
  ordersCount: number;
  grossSubtotal: number;
  feeTotal: number;
};

function toSafeNumber(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function sha256(input: string): string {
  return crypto.createHash("sha256").update(input).digest("hex");
}

export function settlementHashV1(args: SettlementHashInput): string {
  const payload = [
    String(args.businessId || "").trim(),
    String(args.weekKey || "").trim(),
    String(Math.trunc(toSafeNumber(args.ordersCount))),
    String(toSafeNumber(args.grossSubtotal)),
    String(toSafeNumber(args.feeTotal)),
  ].join("|");
  return sha256(payload);
}
