import { isOrderStatus, type OrderStatus } from "@/lib/orderStatus";
import { statusProgressPct } from "@/lib/orderStatusView";

export const DISPATCH_ACTIVE_STATUSES: OrderStatus[] = [
  "new",
  "preparing",
  "out_for_delivery",
];

export function isDispatchStatus(value: string): value is OrderStatus {
  if (!isOrderStatus(value)) return false;
  return DISPATCH_ACTIVE_STATUSES.includes(value);
}

export function isDispatchLate(input: {
  createdAt?: Date | string | null;
  status?: string | null;
  etaMaxMins?: number | null;
}) {
  const status = String(input.status || "").trim();
  if (!isOrderStatus(status)) return false;
  const created = input.createdAt ? new Date(input.createdAt) : null;
  if (!created || Number.isNaN(created.getTime())) return false;
  const etaMaxMins = Math.max(1, Math.round(Number(input.etaMaxMins || 0)));
  const elapsedMs = Date.now() - created.getTime();
  const progress = statusProgressPct(status);
  return elapsedMs > etaMaxMins * 60 * 1000 && progress < 100;
}
