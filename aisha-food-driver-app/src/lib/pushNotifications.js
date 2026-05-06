export async function registerDriverPushNotifications() {
  return {
    enabled: false,
    reason: "push_notifications_not_configured",
  };
}

export function getDriverPushEventTypes() {
  return ["new_order_offer"];
}
