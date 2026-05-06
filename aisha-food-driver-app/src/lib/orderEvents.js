function normalize(value) {
  return String(value || "").trim().toLowerCase();
}

export function shouldRefreshOrders(order) {
  if (!order || typeof order !== "object") {
    return false;
  }

  const deliveryMode = normalize(order.deliveryMode || order.deliverySnapshot?.mode);
  const status = normalize(order.status);
  if (deliveryMode && deliveryMode !== "platform_driver") {
    return false;
  }

  return ["accepted", "preparing", "ready", "out_for_delivery"].includes(status);
}

export function getDriverPollingInterval({
  currentOffer,
  activeOrder,
  isOnline,
  weakNetwork,
  hasPendingSync,
}) {
  if (weakNetwork) {
    return 15000;
  }
  if (currentOffer) {
    return 4000;
  }
  if (shouldRefreshOrders(activeOrder)) {
    return 5000;
  }
  if (hasPendingSync) {
    return 8000;
  }
  if (isOnline) {
    return 10000;
  }
  return 15000;
}

export function getDriverOrderState({ currentOffer, activeOrder, isOnline }) {
  if (shouldRefreshOrders(activeOrder)) {
    return "on_delivery";
  }
  if (currentOffer) {
    return "has_offer";
  }
  if (isOnline) {
    return "online_waiting";
  }
  return "offline";
}
