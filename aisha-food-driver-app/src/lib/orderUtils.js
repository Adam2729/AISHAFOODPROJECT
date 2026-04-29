function firstText(candidates, fallback = "") {
  for (const value of candidates) {
    const safeValue = String(value || "").trim();
    if (safeValue) return safeValue;
  }

  return fallback;
}

function firstNumberOrNull(candidates) {
  for (const value of candidates) {
    const numericValue = Number(value);
    if (Number.isFinite(numericValue)) return numericValue;
  }

  return null;
}

function normalizeStatus(status) {
  return String(status || "assigned").trim().toLowerCase();
}

function formatOrderStatusValue(status) {
  const normalized = normalizeStatus(status);

  switch (normalized) {
    case "accepted":
      return "Accepted";
    case "preparing":
      return "Preparing";
    case "ready":
      return "Ready for pickup";
    case "arrived_at_pickup":
      return "Arrived at pickup";
    case "picked_up":
      return "Picked up";
    case "out_for_delivery":
      return "Out for delivery";
    case "delivered":
      return "Delivered";
    case "completed":
      return "Completed";
    case "cancelled":
      return "Cancelled";
    case "assigned":
    default:
      return "Assigned";
  }
}

export function formatOrderStatus(input) {
  if (input && typeof input === "object") {
    const driverUiLabel = firstText(
      [input?.driverUi?.stageLabel, input?.driverUi?.label],
      ""
    );
    if (driverUiLabel) return driverUiLabel;
    return formatOrderStatusValue(input?.status);
  }

  return formatOrderStatusValue(input);
}

export function formatCurrency(value, currency = "CFA") {
  if (value == null || value === "") {
    return "Non disponible";
  }

  const amount = Number(value);
  if (!Number.isFinite(amount)) {
    return "Non disponible";
  }

  const normalizedCurrency = String(currency || "CFA").trim().toUpperCase();

  if (normalizedCurrency === "CFA" || normalizedCurrency === "XOF" || normalizedCurrency === "FCFA") {
    try {
      return `${new Intl.NumberFormat("en-US", {
        minimumFractionDigits: 0,
        maximumFractionDigits: 0,
      }).format(amount)} FCFA`;
    } catch {
      return `${Math.round(amount).toLocaleString("en-US")} FCFA`;
    }
  }

  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: normalizedCurrency || "USD",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    const prefix = normalizedCurrency || "$";
    return `${prefix} ${amount.toFixed(2)}`;
  }
}

export function getOrderCurrency(order) {
  return firstText([order?.currency, order?.totals?.currency], "CFA");
}

export function formatDateTime(value) {
  if (!value) return "Not available";

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "Not available";

  return parsed.toLocaleString("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export function getOrderId(order) {
  return firstText([order?.id, order?._id, order?.orderId], "");
}

export function getOrderReference(order) {
  return firstText(
    [
      order?.publicOrderCode,
      order?.orderNumber,
      order?.reference,
      order?.code,
      order?.publicId,
      getOrderId(order),
    ],
    "Pending reference"
  );
}

export function getCustomerName(order) {
  return firstText(
    [
      order?.customer?.name,
      order?.customerName,
      order?.delivery?.customerName,
      order?.contact?.customerName,
      order?.contact?.name,
    ],
    "Customer"
  );
}

export function getCustomerPhone(order) {
  return firstText(
    [
      order?.customer?.phone,
      order?.phone,
      order?.delivery?.phone,
      order?.contact?.customerPhone,
      order?.contact?.phone,
    ],
    "Not provided"
  );
}

export function getPickupAddress(order) {
  return firstText(
    [
      order?.pickupAddress,
      order?.pickup?.address,
      order?.restaurant?.address,
      order?.business?.address,
      order?.merchant?.address,
    ],
    "Pickup location unavailable"
  );
}

export function getDropoffAddress(order) {
  return firstText(
    [
      order?.dropoffAddress,
      order?.deliveryAddress,
      order?.dropoff?.address,
      order?.delivery?.address,
      order?.address,
      order?.customer?.address,
    ],
    "Drop-off address unavailable"
  );
}

export function getOrderTotal(order) {
  return firstNumberOrNull(
    [
      order?.totalAmount,
      order?.orderTotal,
      order?.total,
      order?.totals?.total,
      order?.pricing?.total,
      order?.summary?.total,
      order?.payment?.amount,
    ],
  );
}

export function isCompletedOrder(order) {
  return ["delivered", "completed", "cancelled"].includes(normalizeStatus(order?.status));
}

export function getAssignedAt(order) {
  return firstText([order?.assignedAt, order?.createdAt, order?.updatedAt], "");
}
