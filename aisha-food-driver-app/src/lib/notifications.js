function orderKey(order) {
  return String(order?.id || order?._id || order?.orderId || order?.orderNumber || "").trim();
}

export function getOrderChangeNotice(previousOrders, nextOrders) {
  const previousKeys = new Set((Array.isArray(previousOrders) ? previousOrders : []).map(orderKey));
  const newOrders = (Array.isArray(nextOrders) ? nextOrders : []).filter((order) => {
    const key = orderKey(order);
    return key && !previousKeys.has(key);
  });

  if (!newOrders.length) return "";

  const availableCount = newOrders.filter((order) => order?.assignmentType === "available").length;
  const assignedCount = newOrders.length - availableCount;
  if (assignedCount && availableCount) {
    return `${assignedCount} new assigned and ${availableCount} new available order${
      newOrders.length === 1 ? "" : "s"
    }.`;
  }
  if (assignedCount) {
    return `${assignedCount} new assigned order${assignedCount === 1 ? "" : "s"}.`;
  }
  return `${availableCount} new available order${availableCount === 1 ? "" : "s"}.`;
}
