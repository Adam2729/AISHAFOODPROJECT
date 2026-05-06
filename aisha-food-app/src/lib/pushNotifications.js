export async function registerCustomerPushNotifications() {
  return {
    enabled: false,
    reason: "push_notifications_not_configured",
  };
}

export function getCustomerPushEventTypes() {
  return ["order_confirmed", "driver_assigned", "out_for_delivery", "delivered"];
}
