import { getMarketConfig } from "./marketConfig";

function normalize(value) {
  return String(value || "").trim();
}

function getCopy(cityOrMarket) {
  const market = getMarketConfig(cityOrMarket);
  const isSpanish = market.defaultLanguage === "es";

  return {
    market,
    isSpanish,
    supportUnavailable: isSpanish ? "Soporte no disponible" : "Support indisponible",
    waitingForCustomerOtp: isSpanish
      ? "Esperando el codigo del cliente"
      : "En attente du code client",
    otpVerified: isSpanish ? "Codigo verificado" : "Code verifie",
    otpFailed: isSpanish
      ? "OTP fallido - reintenta o usa el respaldo"
      : "OTP echoue - reessaie ou utilise le secours",
    deliveryConfirmed: isSpanish ? "Entrega confirmada" : "Livraison confirmee",
    shareCodeHelp: isSpanish
      ? "Comparte este codigo solo cuando recibas tu pedido."
      : "Partage ce code uniquement au moment de la remise.",
    awaitingDelivery: isSpanish ? "En espera de entrega" : "En attente de livraison",
    cashDueOnDelivery: isSpanish ? "Efectivo contra entrega" : "Cash a la livraison",
    awaitingCashConfirmation: isSpanish
      ? "Esperando confirmacion del efectivo"
      : "En attente de confirmation du cash",
    paid: isSpanish ? "Pagado" : "Paye",
    authorized: isSpanish ? "Autorizado" : "Autorise",
    failed: isSpanish ? "Fallido" : "Echoue",
    refunded: isSpanish ? "Reembolsado" : "Rembourse",
    pending: isSpanish ? "Pendiente" : "En attente",
    orderConfirmed: isSpanish ? "Pedido recibido" : "Commande recue",
    orderConfirmedHint: isSpanish
      ? "El negocio debe aceptar y comenzar la preparacion."
      : "Le commerce doit accepter et commencer la preparation.",
    beingPrepared: isSpanish ? "En preparacion" : "En preparation",
    beingPreparedHint: isSpanish
      ? "El negocio esta preparando tu pedido."
      : "Le commerce prepare ta commande.",
    waitingDriver: isSpanish ? "Esperando repartidor" : "En attente d'un livreur",
    waitingDriverHint: isSpanish
      ? "Tu pedido esta listo y esperando un repartidor de plataforma."
      : "Ta commande est prete et attend un livreur plateforme.",
    driverSearchHint: isSpanish
      ? "Tu pedido esta listo y estamos buscando un repartidor."
      : "Ta commande est prete et nous cherchons un livreur.",
    driverAssigned: isSpanish ? "Repartidor asignado" : "Livreur assigne",
    driverAssignedHint: isSpanish
      ? "Un repartidor fue asignado y va hacia la recogida."
      : "Un livreur est assigne et part vers le retrait.",
    pickedUp: isSpanish ? "Recogido" : "Recuperee",
    pickedUpHint: isSpanish
      ? "El pedido ya fue recogido en el negocio."
      : "La commande a deja ete recuperee au commerce.",
    outForDelivery: isSpanish ? "En camino" : "En route",
    outForDeliveryHint: isSpanish
      ? "El pedido ya fue recogido y va hacia tu direccion."
      : "La commande a ete recuperee et arrive vers toi.",
    arrivingSoon: isSpanish ? "Llega pronto" : "Arrive bientot",
    arrivingSoonHint: isSpanish
      ? "Tu repartidor esta cerca."
      : "Ton livreur est proche.",
    deliveredLabel: isSpanish ? "Entregado" : "Livree",
    deliveredHint: isSpanish
      ? "Tu pedido fue entregado con exito."
      : "Ta commande a ete livree avec succes.",
    cancelledLabel: isSpanish ? "Cancelado" : "Annulee",
    cancelledHint: isSpanish ? "Este pedido fue cancelado." : "Cette commande a ete annulee.",
    readyForHandoff: isSpanish ? "En reparto" : "En livraison",
    readyForHandoffHint: isSpanish
      ? "Tu pedido esta listo para salir."
      : "Ta commande est prete a partir.",
  };
}

function hasOtpFailure(deliveryProof) {
  return Number(deliveryProof?.failedAttempts || 0) > 0;
}

function isDeliveryConfirmed(orderStatus, deliveryProof) {
  const normalizedStatus = normalize(orderStatus).toLowerCase();
  return (
    normalizedStatus === "delivered" ||
    Boolean(deliveryProof?.verifiedAt) ||
    deliveryProof?.verifiedBy === "admin_override" ||
    deliveryProof?.required === false
  );
}

export function getCustomerSafeOrderReference(orderNumber) {
  return normalize(orderNumber) || null;
}

export function getCustomerBusinessName(businessName) {
  return normalize(businessName) || "Restaurant";
}

export function getSupportAvailability(cityOrMarket) {
  const copy = getCopy(cityOrMarket);
  return {
    configured: copy.market.supportWhatsAppConfigured,
    unavailableLabel: copy.supportUnavailable,
  };
}

export function getVisibleDeliveryOtp({ deliveryOtp, orderStatus, deliveryProof }) {
  if (isDeliveryConfirmed(orderStatus, deliveryProof)) return "";
  return normalize(deliveryOtp);
}

export function getMaskedDeliveryOtp(otpLast4) {
  const safeLast4 = normalize(otpLast4).slice(-4);
  return safeLast4 ? `*** ${safeLast4}` : "";
}

export function getDeliveryFinalizationState({ orderStatus, deliveryProof }, cityOrMarket) {
  const copy = getCopy(cityOrMarket);

  if (isDeliveryConfirmed(orderStatus, deliveryProof)) {
    return {
      label: copy.deliveryConfirmed,
      detail:
        deliveryProof?.verifiedAt || deliveryProof?.verifiedBy === "customer_code"
          ? copy.otpVerified
          : null,
    };
  }

  if (hasOtpFailure(deliveryProof)) {
    return {
      label: copy.otpFailed,
      detail: copy.shareCodeHelp,
    };
  }

  return {
    label: copy.waitingForCustomerOtp,
    detail: copy.shareCodeHelp,
  };
}

export function getCustomerPaymentStatusLabel(payment, orderStatus, cityOrMarket) {
  const copy = getCopy(cityOrMarket);
  const method = normalize(payment?.method).toLowerCase() || "cash";
  const status = normalize(payment?.status).toLowerCase() || "pending";
  const normalizedOrderStatus = normalize(orderStatus).toLowerCase();

  if (status === "paid") return copy.paid;
  if (status === "authorized") return copy.authorized;
  if (status === "failed") return copy.failed;
  if (status === "refunded") return copy.refunded;

  if (method === "cash") {
    if (normalizedOrderStatus === "delivered") {
      return copy.awaitingCashConfirmation;
    }
    if (normalizedOrderStatus === "ready" || normalizedOrderStatus === "out_for_delivery") {
      return copy.cashDueOnDelivery;
    }
    return copy.awaitingDelivery;
  }

  return copy.pending;
}

function normalizeDeliveryMode(value) {
  return normalize(value) === "platform_driver" ? "platform_driver" : "self_delivery";
}

function fallbackCustomerStageKey(snapshot) {
  const status = normalize(snapshot?.status).toLowerCase() || "new";
  const deliveryMode = normalizeDeliveryMode(
    snapshot?.deliveryMode || snapshot?.delivery?.mode || snapshot?.deliveryUi?.deliveryMode
  );
  const driverAssigned = Boolean(snapshot?.deliveryUi?.driverAssigned || snapshot?.driverName);
  const arrivingSoon = Boolean(snapshot?.deliveryUi?.arrivingSoon);
  const pickedUp =
    Boolean(snapshot?.deliveryUi?.pickedUp) ||
    Boolean(snapshot?.delivery?.pickedUpAt) ||
    Boolean(snapshot?.dispatch?.pickedUpAt);

  if (status === "cancelled") return "cancelled";
  if (status === "delivered") return "delivered";
  if (deliveryMode === "platform_driver" && pickedUp && status === "ready") {
    return "picked_up";
  }
  if (status === "out_for_delivery") return arrivingSoon ? "arriving_soon" : "out_for_delivery";
  if (deliveryMode === "platform_driver" && status === "ready" && driverAssigned) {
    return "driver_assigned";
  }
  if (["accepted", "preparing", "ready"].includes(status)) {
    return "being_prepared";
  }
  return "order_confirmed";
}

function buildCustomerTimeline(stageKey, deliveryMode, driverAssigned, copy) {
  const rows =
    deliveryMode === "platform_driver"
      ? [
          { key: "order_confirmed", label: copy.orderConfirmed },
          { key: "being_prepared", label: copy.beingPrepared },
          { key: "driver_assigned", label: copy.driverAssigned },
          { key: "picked_up", label: copy.pickedUp },
          { key: "out_for_delivery", label: stageKey === "arriving_soon" ? copy.arrivingSoon : copy.outForDelivery },
          { key: "delivered", label: copy.deliveredLabel },
        ]
      : [
          { key: "order_confirmed", label: copy.orderConfirmed },
          { key: "being_prepared", label: copy.beingPrepared },
          { key: "out_for_delivery", label: copy.readyForHandoff },
          { key: "delivered", label: copy.deliveredLabel },
        ];

  if (stageKey === "cancelled") {
    return rows
      .map((row, index) => ({
        ...row,
        done: index === 0,
        active: false,
      }))
      .concat({
        key: "cancelled",
        label: copy.cancelledLabel,
        done: false,
        active: true,
      });
  }

  const stageIndexMap = {
    order_confirmed: 0,
    being_prepared: 1,
    waiting_driver: deliveryMode === "platform_driver" ? 1 : 1,
    driver_assigned: deliveryMode === "platform_driver" ? 2 : 1,
    picked_up: deliveryMode === "platform_driver" ? 3 : 2,
    out_for_delivery: deliveryMode === "platform_driver" ? 4 : 2,
    arriving_soon: deliveryMode === "platform_driver" ? 4 : 2,
    delivered: deliveryMode === "platform_driver" ? 5 : 3,
  };
  const activeIndex = stageIndexMap[stageKey] ?? 0;

  return rows.map((row, index) => ({
    ...row,
    done: index < activeIndex,
    active: index === activeIndex,
  }));
}

export function getCustomerDeliveryPresentation(snapshot, cityOrMarket) {
  const copy = getCopy(cityOrMarket);
  const deliveryUi = snapshot?.deliveryUi || {};
  const deliveryMode = normalizeDeliveryMode(
    deliveryUi.deliveryMode || snapshot?.deliveryMode || snapshot?.delivery?.mode
  );
  const driverAssigned = Boolean(deliveryUi.driverAssigned || snapshot?.driverName);
  const stageKey = normalize(deliveryUi.stageKey).toLowerCase() || fallbackCustomerStageKey(snapshot);

  let label = copy.orderConfirmed;
  let hint = copy.orderConfirmedHint;
  let progressPct = Number(deliveryUi.progressPct || 10);

  switch (stageKey) {
    case "being_prepared":
      label = copy.beingPrepared;
      hint = copy.beingPreparedHint;
      progressPct = Number(deliveryUi.progressPct || 45);
      break;
    case "waiting_driver":
      label = copy.beingPrepared;
      hint = copy.driverSearchHint;
      progressPct = Number(deliveryUi.progressPct || 60);
      break;
    case "driver_assigned":
      label = copy.driverAssigned;
      hint = copy.driverAssignedHint;
      progressPct = Number(deliveryUi.progressPct || 70);
      break;
    case "picked_up":
      label = copy.pickedUp;
      hint = copy.pickedUpHint;
      progressPct = Number(deliveryUi.progressPct || 78);
      break;
    case "out_for_delivery":
      label = deliveryMode === "platform_driver" ? copy.outForDelivery : copy.readyForHandoff;
      hint = copy.outForDeliveryHint;
      progressPct = Number(deliveryUi.progressPct || 85);
      break;
    case "arriving_soon":
      label = copy.arrivingSoon;
      hint = copy.arrivingSoonHint;
      progressPct = Number(deliveryUi.progressPct || 92);
      break;
    case "delivered":
      label = copy.deliveredLabel;
      hint = copy.deliveredHint;
      progressPct = Number(deliveryUi.progressPct || 100);
      break;
    case "cancelled":
      label = copy.cancelledLabel;
      hint = copy.cancelledHint;
      progressPct = Number(deliveryUi.progressPct || 100);
      break;
    default:
      label = copy.orderConfirmed;
      hint = copy.orderConfirmedHint;
      progressPct = Number(deliveryUi.progressPct || 10);
      break;
  }

  return {
    deliveryMode,
    stageKey,
    label,
    hint,
    progressPct,
    driverAssigned,
    outForDelivery:
      stageKey === "picked_up" || stageKey === "out_for_delivery" || stageKey === "arriving_soon",
    timeline: buildCustomerTimeline(stageKey, deliveryMode, driverAssigned, copy),
  };
}
