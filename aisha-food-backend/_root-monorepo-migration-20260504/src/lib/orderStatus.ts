export type OrderStatus =
  | "new"
  | "accepted"
  | "preparing"
  | "ready"
  | "out_for_delivery"
  | "delivered"
  | "cancelled";

export const ORDER_STATUS_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  new: ["accepted", "cancelled"],
  accepted: ["preparing", "cancelled"],
  preparing: ["ready", "cancelled"],
  ready: ["out_for_delivery", "delivered", "cancelled"],
  out_for_delivery: ["delivered", "cancelled"],
  delivered: [],
  cancelled: [],
};

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return ORDER_STATUS_TRANSITIONS[from].includes(to);
}

export function isFinalStatus(status: OrderStatus): boolean {
  return status === "delivered" || status === "cancelled";
}

export function isOrderStatus(value: string): value is OrderStatus {
  return (
    value === "new" ||
    value === "accepted" ||
    value === "preparing" ||
    value === "ready" ||
    value === "out_for_delivery" ||
    value === "delivered" ||
    value === "cancelled"
  );
}
