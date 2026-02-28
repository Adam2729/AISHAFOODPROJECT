import crypto from "crypto";
import mongoose from "mongoose";

type IntegrityInput = {
  businessId: string | mongoose.Types.ObjectId;
  weekKey: string;
  ordersCount: number;
  grossSubtotal: number;
  feeTotal: number;
};

function toFixedSafe(value: number) {
  const parsed = Number(value || 0);
  if (!Number.isFinite(parsed)) return "0.000000";
  return parsed.toFixed(6);
}

export function computeSettlementIntegrityHash(input: IntegrityInput) {
  const payload = [
    String(input.businessId),
    String(input.weekKey || "").trim(),
    String(Math.trunc(Number(input.ordersCount || 0))),
    toFixedSafe(Number(input.grossSubtotal || 0)),
    toFixedSafe(Number(input.feeTotal || 0)),
  ].join("|");
  return crypto.createHash("sha256").update(payload).digest("hex");
}

