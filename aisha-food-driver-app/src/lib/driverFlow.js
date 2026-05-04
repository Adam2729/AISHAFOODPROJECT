function firstText(candidates, fallback = "") {
  for (const value of candidates) {
    const text = String(value || "").trim();
    if (text) return text;
  }
  return fallback;
}

function firstNumberOrNull(candidates) {
  for (const value of candidates) {
    const number = Number(value);
    if (Number.isFinite(number)) return number;
  }
  return null;
}

function normalizePoint(point) {
  if (!point || typeof point !== "object") return null;

  const latitude = Number(point.latitude ?? point.lat);
  const longitude = Number(point.longitude ?? point.lng);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return null;
  }

  return {
    latitude,
    longitude,
    lat: latitude,
    lng: longitude,
  };
}

export function getDriverUiMode({ driver, currentOffer, activeOrder, pendingSyncCount = 0 }) {
  if (currentOffer) return "hasOffer";
  if (activeOrder) return "onDelivery";
  if (pendingSyncCount > 0) return "syncPending";
  const availability = String(driver?.availability || "offline").trim().toLowerCase();
  if (availability === "available" || availability === "busy" || availability === "paused") {
    return "online";
  }
  return "offline";
}

export function getDisplayDriverName(driver) {
  return firstText(
    [driver?.name, driver?.fullName, driver?.displayName, driver?.firstName],
    "Livreur"
  );
}

export function getDriverAvailabilityLabel(driver) {
  const availability = String(driver?.availability || "offline").trim().toLowerCase();
  switch (availability) {
    case "available":
      return "En ligne";
    case "busy":
      return "En livraison";
    case "paused":
      return "En pause";
    default:
      return "Hors ligne";
  }
}

export function getOrderPaymentLabel(order) {
  const method = String(
    order?.paymentMethod || order?.paymentSummary?.method || ""
  )
    .trim()
    .toLowerCase();
  const status = String(
    order?.paymentStatus || order?.paymentSummary?.status || ""
  )
    .trim()
    .toLowerCase();
  const amountToCollect = getOrderAmountToCollect(order);

  if (
    status === "paid" &&
    typeof amountToCollect === "number" &&
    amountToCollect <= 0 &&
    ["paytech", "mobile_money", "orange_money", "wave", "moov_money"].includes(method)
  ) {
    return "Paid online";
  }

  return firstText(
    [
      order?.paymentSummary?.methodLabel,
      order?.paymentSummary?.provider,
      order?.paymentMethod,
      order?.paymentSummary?.method,
    ],
    "Non precise"
  );
}

export function getOrderAmountToCollect(order) {
  return firstNumberOrNull([order?.amountToCollect]);
}

export function getBusinessName(order) {
  return firstText([order?.business?.name, order?.businessName, order?.restaurantName], "Restaurant");
}

export function getBusinessPhone(order) {
  return firstText([order?.business?.phone, order?.contact?.businessPhone], "");
}

export function getCustomerPhoneForCall(order) {
  return firstText(
    [order?.contact?.customerPhone, order?.customerPhone, order?.customer?.phone, order?.phone],
    ""
  );
}

export function getBusinessAddress(order) {
  return firstText(
    [order?.pickupAddress, order?.business?.address, order?.pickup?.address],
    "Adresse non disponible"
  );
}

export function getCustomerAddress(order) {
  return firstText(
    [
      order?.dropoffAddress,
      order?.deliveryAddress,
      order?.dropoff?.address,
      order?.customer?.address,
      order?.address,
    ],
    "Adresse non disponible"
  );
}

export function getDeliveryNotes(order) {
  return firstText(
    [
      order?.deliveryNote,
      order?.landmark,
      order?.notes,
      order?.dispatch?.handoffNote,
      order?.dispatch?.paymentCollectionNote,
    ],
    ""
  );
}

export function getPickupLocation(order) {
  return normalizePoint(
    (order?.pickupLat != null && order?.pickupLng != null
      ? { lat: order.pickupLat, lng: order.pickupLng }
      : null) ||
      order?.pickupLocation ||
      order?.pickup?.location ||
      order?.restaurant?.location ||
      order?.business?.location
  );
}

export function getDropoffLocation(order) {
  return normalizePoint(
    (order?.dropoffLat != null && order?.dropoffLng != null
      ? { lat: order.dropoffLat, lng: order.dropoffLng }
      : null) ||
      order?.dropoffLocation ||
      order?.dropoff?.location ||
      order?.customer?.location ||
      order?.deliveryAddressLocation
  );
}

export function requiresPaymentConfirmation(order) {
  const amountToCollect = getOrderAmountToCollect(order);
  return typeof amountToCollect === "number" && amountToCollect > 0 && !order?.dispatch?.paymentCollectedAt;
}

export function getCurrentDeliveryStep(order) {
  if (!order || typeof order !== "object") {
    return { key: "offline", label: "Hors ligne", hint: null };
  }

  if (String(order?.status || "").trim().toLowerCase() === "delivered") {
    return {
      key: "delivered",
      label: "Livree",
      hint: "La livraison est terminee.",
    };
  }

  if (order?.dispatch?.paymentCollectedAt) {
    return {
      key: "payment_collected",
      label: "Paiement confirme",
      hint: "Finalisez la remise client.",
    };
  }

  if (order?.dispatch?.arrivedAtCustomerAt) {
    return {
      key: "at_customer",
      label: "Chez le client",
      hint: "Remettez la commande et confirmez la fin de course.",
    };
  }

  if (String(order?.status || "").trim().toLowerCase() === "out_for_delivery") {
    return {
      key: "on_the_way",
      label: "Vers le client",
      hint: "Ouvrez la navigation et dirigez-vous vers l'adresse du client.",
    };
  }

  if (order?.dispatch?.pickupConfirmedAt) {
    return {
      key: "picked_up",
      label: "Vers le client",
      hint: "La commande est recuperee. Dirigez-vous vers le client.",
    };
  }

  if (order?.dispatch?.driverArrivedAt) {
    return {
      key: "at_restaurant",
      label: "Au restaurant",
      hint: "Recuperez la commande des qu'elle est prete.",
    };
  }

  return {
    key: "heading_to_pickup",
    label: "Vers le restaurant",
    hint: "Le prochain point est le retrait.",
  };
}

export function getNextDriverAction(order) {
  if (!order || typeof order !== "object") return null;
  const status = String(order?.status || "").trim().toLowerCase();
  if (status === "delivered" || status === "cancelled") {
    return null;
  }

  if (!order?.dispatch?.driverArrivedAt) {
    return { type: "arrived_restaurant", label: "Arrived at restaurant" };
  }

  if (!order?.dispatch?.pickupConfirmedAt) {
    return { type: "picked_up", label: "Confirm pickup" };
  }

  if (!order?.dispatch?.arrivedAtCustomerAt) {
    return { type: "arrived_customer", label: "Arrived at customer" };
  }

  if (requiresPaymentConfirmation(order)) {
    return { type: "payment", label: "Confirm payment" };
  }

  return { type: "delivered", label: "Complete delivery" };
}

export function getWeakNetworkMessage() {
  return "Connexion faible. Certaines informations peuvent etre mises a jour plus tard.";
}

export function getOfflineSavedMessage() {
  return "Saved offline. Will sync when network returns.";
}
