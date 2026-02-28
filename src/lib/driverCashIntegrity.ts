import { createHmac } from "node:crypto";
import { ENV_JWT_SECRET } from "@/lib/env";
import { roundCurrency } from "@/lib/money";

type DriverCashHashInput = {
  orderId: string;
  businessId: string;
  driverId: string;
  weekKey: string;
  amountCollectedRdp: number;
  collectedAtISO: string;
};

export function computeDriverCashExpectedHash(input: DriverCashHashInput) {
  const payload = [
    String(input.orderId || "").trim(),
    String(input.businessId || "").trim(),
    String(input.driverId || "").trim(),
    String(input.weekKey || "").trim(),
    roundCurrency(Number(input.amountCollectedRdp || 0)).toFixed(2),
    String(input.collectedAtISO || "").trim(),
  ].join("|");
  return createHmac("sha256", ENV_JWT_SECRET).update(payload).digest("base64url");
}
