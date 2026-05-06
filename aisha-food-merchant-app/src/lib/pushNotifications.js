export async function registerMerchantPushNotifications() {
  return {
    enabled: false,
    reason: "push_notifications_not_configured",
  };
}

export function getMerchantPushEventTypes() {
  return ["new_order"];
}
