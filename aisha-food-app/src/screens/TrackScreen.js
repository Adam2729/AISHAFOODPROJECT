import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  AppState,
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import OrderTimeline from "../components/OrderTimeline";
import { useAppShell } from "../context/AppShellContext";
import { fetchOrderTrackingSnapshot } from "../lib/orderTracking";
import {
  paymentMethodLabel,
  paymentStatusLabel as formatPaymentStatusLabel,
  formatDateTime,
} from "../lib/formatters";
import formatPrice from "../lib/formatPrice";
import {
  getCustomerBusinessName,
  getCustomerDeliveryPresentation,
  getCustomerPaymentStatusLabel,
  getCustomerSafeOrderReference,
  getDeliveryFinalizationState,
  getMaskedDeliveryOtp,
  getSupportAvailability,
  getVisibleDeliveryOtp,
} from "../lib/orderPresentation";
import { playSound } from "../lib/soundManager";
import { openSupportWhatsApp } from "../lib/supportWhatsApp";
import { getCustomerUiCopy } from "../lib/customerUi";
import { speak } from "../lib/voiceManager";
import { useSafeKeepAwake } from "../lib/keepAwake";

function isObjectIdLike(value) {
  return /^[a-f0-9]{24}$/i.test(String(value || "").trim());
}

function driverStatusLabel(stageKey) {
  switch (String(stageKey || "").trim().toLowerCase()) {
    case "accepted":
      return "assigned";
    case "preparing":
      return "arriving_at_restaurant";
    case "ready":
      return "picked_up";
    case "out_for_delivery":
      return "on_the_way";
    case "delivered":
      return "delivered";
    default:
      return "assigned";
  }
}

export default function TrackScreen({ route }) {
  const { selectedCity: city, market } = useAppShell();
  const initialOrderId = String(route?.params?.orderId || "").trim();
  const orderNumber = String(route?.params?.orderNumber || "").trim();
  const initialBusinessName = String(route?.params?.businessName || "").trim() || "Restaurant";
  const routeDeliveryOtp = String(route?.params?.deliveryOtp || "").trim();
  const routeDeliveryProof = route?.params?.deliveryProof || null;
  const initialOrderReference = orderNumber || initialOrderId;

  const [orderReferenceInput, setOrderReferenceInput] = useState(initialOrderReference);
  const [activeOrderId, setActiveOrderId] = useState(initialOrderId);
  const [activeOrderReference, setActiveOrderReference] = useState(orderNumber);
  const [snapshot, setSnapshot] = useState(null);
  const [loading, setLoading] = useState(Boolean(initialOrderId || orderNumber));
  const [isUpdating, setIsUpdating] = useState(false);
  const [error, setError] = useState("");
  const [networkNotice, setNetworkNotice] = useState("");
  const inFlightRef = useRef(false);
  const appStateRef = useRef(AppState.currentState);
  const previousPaymentStatusRef = useRef("");
  const previousOrderStatusRef = useRef("");
  const previousStageKeyRef = useRef("");

  const uiCopy = useMemo(() => getCustomerUiCopy(market), [market]);
  const supportAvailability = useMemo(() => getSupportAvailability(market), [market]);
  const isSpanish = market.defaultLanguage === "es";
  const text = isSpanish
    ? {
        title: "Seguir mi pedido",
        subtitle: "Usa tu referencia de pedido para seguir el estado en tiempo real.",
        placeholder: "Referencia del pedido",
        refresh: "Actualizar seguimiento",
        loading: "Cargando detalles del seguimiento...",
        unavailable: "Seguimiento no disponible",
        enterOrder: "Ingresa una referencia de pedido para ver el seguimiento.",
        loadError: "No fue posible cargar los detalles del seguimiento.",
        orderDetails: "Detalles del pedido",
        orderNumber: "Referencia",
        orderReferenceUnavailable: "Referencia pendiente",
        restaurant: "Restaurante",
        steps: "Etapas",
        payment: "Pago",
        paidAt: "Pagado el",
        provider: "Proveedor",
        total: "Total",
        driver: "Repartidor",
        eta: "ETA",
        loyaltyPending: "Puntos pendientes despues de la entrega",
        referralPending: "La recompensa de referido se aplicara despues de una entrega exitosa.",
        paymentEvents: "Ultimos eventos de pago",
        support: "Soporte por WhatsApp",
        supportUnavailable: "Soporte no disponible",
        otpTitle: "Codigo de entrega",
        otpLast4: "Ultimos 4 digitos",
        verifiedAt: "Confirmado el",
        etaApprox: "ETA aprox.",
        liveLocation: "Ubicacion mas reciente",
        locationUpdated: "Actualizado el",
      }
    : {
        title: "Suivre ma commande",
        subtitle: "Utilise ta reference de commande pour suivre le statut en direct.",
        placeholder: "Reference de commande",
        refresh: "Actualiser le suivi",
        loading: "Chargement des details du suivi...",
        unavailable: "Suivi indisponible",
        enterOrder: "Entre une reference de commande pour voir le suivi.",
        loadError: "Impossible de charger les details du suivi.",
        orderDetails: "Details de la commande",
        orderNumber: "Reference",
        orderReferenceUnavailable: "Reference en attente",
        restaurant: "Restaurant",
        steps: "Etapes",
        payment: "Paiement",
        paidAt: "Paye le",
        provider: "Fournisseur",
        total: "Total",
        driver: "Livreur",
        eta: "ETA",
        loyaltyPending: "Points en attente apres livraison",
        referralPending: "La recompense de parrainage sera appliquee apres une livraison reussie.",
        paymentEvents: "Derniers evenements de paiement",
        support: "Support WhatsApp",
        supportUnavailable: "Support indisponible",
        otpTitle: "Code de livraison",
        otpLast4: "4 derniers chiffres",
        verifiedAt: "Confirme le",
        etaApprox: "ETA approx.",
        liveLocation: "Derniere position connue",
        locationUpdated: "Mis a jour le",
      };

  async function load(orderReferenceOrId, options = {}) {
    const { silent = false } = options;
    const safeLookup = String(orderReferenceOrId || "").trim();
    const fallbackReference = String(activeOrderReference || orderNumber || "").trim();
    const lookupOrderId = isObjectIdLike(safeLookup)
      ? safeLookup
      : !safeLookup || safeLookup === fallbackReference
        ? String(activeOrderId || initialOrderId || "").trim()
        : "";
    const lookupOrderNumber = isObjectIdLike(safeLookup) ? fallbackReference : safeLookup || fallbackReference;

    if (!lookupOrderId && !lookupOrderNumber) {
      setError(text.enterOrder);
      return;
    }

    if (inFlightRef.current) {
      return;
    }

    inFlightRef.current = true;
    if (silent && snapshot) {
      setIsUpdating(true);
    } else {
      setLoading(true);
    }
    if (!snapshot) setError("");
    setNetworkNotice("");
    try {
      const response = await fetchOrderTrackingSnapshot({
        orderId: lookupOrderId,
        orderNumber: lookupOrderNumber,
        businessName: initialBusinessName,
      });
      const resolvedReference = String(response?.orderNumber || lookupOrderNumber || "").trim();
      setSnapshot(response);
      setActiveOrderId(String(response?.orderId || lookupOrderId || "").trim());
      setActiveOrderReference(resolvedReference);
      setOrderReferenceInput(resolvedReference || safeLookup);
    } catch (requestError) {
      if (snapshot) {
        setNetworkNotice(uiCopy.weakConnection);
      } else {
        setSnapshot(null);
        setError(requestError?.message || text.loadError);
      }
    } finally {
      inFlightRef.current = false;
      setLoading(false);
      setIsUpdating(false);
    }
  }

  useEffect(() => {
    if (!initialOrderId && !orderNumber) return undefined;
    load(initialOrderReference, { silent: false }).catch(() => null);
  }, [initialOrderId, orderNumber]);

  useEffect(() => {
    if (!activeOrderId && !activeOrderReference) return undefined;
    const timer = setInterval(() => {
      load(activeOrderId || activeOrderReference, { silent: true }).catch(() => null);
    }, 5000);
    return () => clearInterval(timer);
  }, [activeOrderId, activeOrderReference]);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (nextState) => {
      const wasBackgrounded = appStateRef.current !== "active" && nextState === "active";
      appStateRef.current = nextState;
      if (wasBackgrounded && (activeOrderId || activeOrderReference)) {
        load(activeOrderId || activeOrderReference, { silent: true }).catch(() => null);
      }
    });

    return () => {
      subscription.remove();
    };
  }, [activeOrderId, activeOrderReference]);

  useEffect(() => {
    const nextPaymentStatus = String(snapshot?.payment?.status || "").trim().toLowerCase();
    const previousPaymentStatus = previousPaymentStatusRef.current;
    previousPaymentStatusRef.current = nextPaymentStatus;
    if (
      nextPaymentStatus === "paid" &&
      previousPaymentStatus &&
      previousPaymentStatus !== "paid" &&
      (activeOrderId || activeOrderReference)
    ) {
      load(activeOrderId || activeOrderReference, { silent: true }).catch(() => null);
    }
  }, [activeOrderId, activeOrderReference, snapshot?.payment?.status]);

  const paymentEvents = useMemo(
    () => (Array.isArray(snapshot?.paymentEvents) ? snapshot.paymentEvents.slice(0, 3) : []),
    [snapshot?.paymentEvents]
  );
  const totalAmount = useMemo(() => {
    const numericAmount = Number(snapshot?.totalAmount);
    if (Number.isFinite(numericAmount)) return numericAmount;
    const eventAmount = paymentEvents.find((event) => Number.isFinite(Number(event?.amount)));
    return eventAmount ? Number(eventAmount.amount) : null;
  }, [paymentEvents, snapshot?.totalAmount]);
  const activeDeliveryProof = snapshot?.deliveryProof || routeDeliveryProof || null;
  const currentStatus = String(snapshot?.status || route?.params?.status || "new");
  const businessName = getCustomerBusinessName(snapshot?.businessName || initialBusinessName);
  const orderReference = getCustomerSafeOrderReference(snapshot?.orderNumber || activeOrderReference || orderNumber);
  const paymentStatusLabel = getCustomerPaymentStatusLabel(snapshot?.payment, currentStatus, market);
  const deliveryPresentation = getCustomerDeliveryPresentation(snapshot, market);
  const deliveryState = getDeliveryFinalizationState(
    {
      orderStatus: currentStatus,
      deliveryProof: activeDeliveryProof,
    },
    market
  );
  const visibleDeliveryOtp = getVisibleDeliveryOtp({
    deliveryOtp: routeDeliveryOtp,
    orderStatus: currentStatus,
    deliveryProof: activeDeliveryProof,
  });
  const maskedDeliveryOtp = getMaskedDeliveryOtp(activeDeliveryProof?.otpLast4);
  const driverLocation = snapshot?.driverLocation || null;
  const canShowEta =
    Number.isFinite(Number(snapshot?.etaMinutes)) &&
    !["pending_payment", "cancelled", "delivered"].includes(deliveryPresentation.stageKey);
  const currentDriverStatus = driverStatusLabel(deliveryPresentation.stageKey);
  const shouldKeepScreenAwake =
    Boolean(snapshot) &&
    !loading &&
    ["new", "accepted", "preparing", "ready", "out_for_delivery"].includes(
      String(currentStatus || "").trim().toLowerCase()
    );

  useSafeKeepAwake(shouldKeepScreenAwake, "oranjeeats-customer-track");

  useEffect(() => {
    if (!snapshot) return;

    const nextOrderStatus = String(currentStatus || "").trim().toLowerCase();
    const nextStageKey = String(deliveryPresentation.stageKey || "").trim().toLowerCase();
    const previousOrderStatus = previousOrderStatusRef.current;
    const previousStageKey = previousStageKeyRef.current;

    if (!previousOrderStatus && !previousStageKey) {
      previousOrderStatusRef.current = nextOrderStatus;
      previousStageKeyRef.current = nextStageKey;
      return;
    }

    if (nextOrderStatus === "accepted" && previousOrderStatus !== "accepted") {
      playSound("accepted").catch(() => null);
    }

    if (nextStageKey === "arriving_soon" && previousStageKey !== "arriving_soon") {
      playSound("message").catch(() => null);
      speak("Driver nearby");
    }

    if (nextOrderStatus === "delivered" && previousOrderStatus !== "delivered") {
      playSound("delivered").catch(() => null);
    }

    previousOrderStatusRef.current = nextOrderStatus;
    previousStageKeyRef.current = nextStageKey;
  }, [currentStatus, deliveryPresentation.stageKey, snapshot]);

  return (
    <ScrollView contentContainerStyle={styles.content}>
      <Text style={styles.title}>{text.title}</Text>
      <Text style={styles.subtitle}>{text.subtitle}</Text>

      <View style={styles.card}>
        <TextInput
          value={orderReferenceInput}
          onChangeText={setOrderReferenceInput}
          placeholder={text.placeholder}
          placeholderTextColor="#94A3B8"
          style={styles.input}
          autoCapitalize="none"
        />
        <Pressable
          style={styles.primaryButton}
          onPress={() => load(orderReferenceInput, { silent: false })}
        >
          <Text style={styles.primaryButtonText}>{text.refresh}</Text>
        </Pressable>
      </View>

      {loading ? (
        <View style={styles.stateCard}>
          <ActivityIndicator color="#F97316" />
          <Text style={styles.stateText}>{text.loading}</Text>
        </View>
      ) : null}

      {!loading && isUpdating ? (
        <View style={styles.noticeCard}>
          <Text style={styles.noticeText}>Updating order status...</Text>
        </View>
      ) : null}

      {networkNotice ? (
        <View style={styles.noticeCard}>
          <Text style={styles.noticeText}>{networkNotice}</Text>
        </View>
      ) : null}

      {!loading && error ? (
        <View style={styles.stateCard}>
          <Text style={styles.stateTitle}>{text.unavailable}</Text>
          <Text style={styles.stateText}>{error}</Text>
        </View>
      ) : null}

      {!loading && snapshot ? (
        <>
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>{text.orderDetails}</Text>
            <Text style={styles.helperText}>{text.orderNumber}: {orderReference || text.orderReferenceUnavailable}</Text>
            <Text style={styles.helperText}>{text.restaurant}: {businessName}</Text>
          </View>

          <View style={styles.card}>
            <Text style={styles.sectionTitle}>{text.steps}</Text>
            <Text style={styles.stageLabel}>{deliveryPresentation.label}</Text>
            {deliveryPresentation.hint ? (
              <Text style={styles.helperText}>{deliveryPresentation.hint}</Text>
            ) : null}
            {deliveryPresentation.stageKey !== "pending_payment" ? (
              <OrderTimeline status={currentStatus} city={city} rows={deliveryPresentation.timeline} />
            ) : null}
            {canShowEta ? (
              <Text style={styles.helperText}>{text.etaApprox}: {Number(snapshot?.etaMinutes)} min</Text>
            ) : null}
          </View>

          {deliveryPresentation.stageKey !== "pending_payment" && (visibleDeliveryOtp || maskedDeliveryOtp || deliveryState?.label) ? (
            <View style={styles.noticeCard}>
              <Text style={styles.sectionTitle}>{text.otpTitle}</Text>
              {deliveryState?.label ? (
                <Text style={styles.noticeText}>{deliveryState.label}</Text>
              ) : null}
              {visibleDeliveryOtp ? (
                <Text style={styles.otpCode}>{visibleDeliveryOtp}</Text>
              ) : null}
              {!visibleDeliveryOtp && maskedDeliveryOtp ? (
                <Text style={styles.helperText}>
                  {text.otpLast4}: {maskedDeliveryOtp}
                </Text>
              ) : null}
              {deliveryState?.detail ? <Text style={styles.noticeText}>{deliveryState.detail}</Text> : null}
              {activeDeliveryProof?.verifiedAt ? (
                <Text style={styles.helperText}>
                  {text.verifiedAt}: {formatDateTime(activeDeliveryProof.verifiedAt, market)}
                </Text>
              ) : null}
            </View>
          ) : null}

          <View style={styles.card}>
            <Text style={styles.sectionTitle}>{text.payment}</Text>
            <Text style={styles.helperText}>
              {paymentMethodLabel(snapshot?.payment?.method, market)} | {paymentStatusLabel}
            </Text>
            {snapshot?.payment?.paidAt ? (
              <Text style={styles.helperText}>{text.paidAt} {formatDateTime(snapshot.payment.paidAt, market)}</Text>
            ) : null}
            {snapshot?.payment?.provider ? (
              <Text style={styles.helperText}>{text.provider}: {snapshot.payment.provider}</Text>
            ) : null}
            {totalAmount != null ? (
              <Text style={styles.helperText}>{text.total}: {formatPrice(totalAmount, market)}</Text>
            ) : null}
          </View>

          {(snapshot?.driverName || snapshot?.driverPhone || driverLocation) ? (
            <View style={styles.card}>
              <Text style={styles.sectionTitle}>{text.driver}</Text>
              <Text style={styles.helperText}>Status: {currentDriverStatus}</Text>
              {snapshot?.driverName ? <Text style={styles.helperText}>{snapshot.driverName}</Text> : null}
              {snapshot?.driverPhone ? <Text style={styles.helperText}>{snapshot.driverPhone}</Text> : null}
              {driverLocation ? (
                <>
                  <Text style={styles.helperText}>
                    {text.liveLocation}: {Number(driverLocation.latitude).toFixed(5)},{" "}
                    {Number(driverLocation.longitude).toFixed(5)}
                  </Text>
                  {driverLocation?.updatedAt ? (
                    <Text style={styles.eventDate}>
                      {text.locationUpdated}: {formatDateTime(driverLocation.updatedAt, market)}
                    </Text>
                  ) : null}
                </>
              ) : canShowEta ? (
                <Text style={styles.helperText}>
                  Tracking map not ready. ETA: {Number(snapshot?.etaMinutes)} min.
                </Text>
              ) : null}
            </View>
          ) : null}

          {(snapshot?.loyaltyPointsPending > 0 || snapshot?.referralRewardPending) ? (
            <View style={styles.noticeCard}>
              {snapshot?.loyaltyPointsPending > 0 ? (
                <Text style={styles.noticeText}>
                  {text.loyaltyPending}: {snapshot.loyaltyPointsPending}
                </Text>
              ) : null}
              {snapshot?.referralRewardPending ? (
                <Text style={styles.noticeText}>{text.referralPending}</Text>
              ) : null}
            </View>
          ) : null}

          {paymentEvents.length ? (
            <View style={styles.card}>
              <Text style={styles.sectionTitle}>{text.paymentEvents}</Text>
              {paymentEvents.map((event, index) => (
                <View key={`${event?.createdAt || index}-${index}`} style={styles.eventRow}>
                  <Text style={styles.helperText}>
                    {paymentMethodLabel(event?.method, market)} | {formatPaymentStatusLabel(event?.status, market)}
                  </Text>
                  <Text style={styles.eventDate}>{formatDateTime(event?.createdAt, market)}</Text>
                </View>
              ))}
            </View>
          ) : null}

          <Pressable
            style={[styles.secondaryButton, !supportAvailability.configured && styles.secondaryButtonDisabled]}
            disabled={!supportAvailability.configured}
            onPress={() =>
              openSupportWhatsApp({
                orderNumber: orderReference,
                businessName,
                city,
              })
            }
          >
            <Text style={styles.secondaryButtonText}>
              {supportAvailability.configured ? text.support : text.supportUnavailable}
            </Text>
          </Pressable>
        </>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: {
    padding: 16,
    paddingBottom: 32,
    backgroundColor: "#F8FAFC",
    gap: 14,
  },
  title: {
    fontSize: 30,
    fontWeight: "900",
    color: "#0F172A",
  },
  subtitle: {
    color: "#64748B",
    fontSize: 14,
  },
  card: {
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#E2E8F0",
    borderRadius: 16,
    padding: 14,
    gap: 10,
  },
  input: {
    minHeight: 48,
    borderWidth: 1,
    borderColor: "#CBD5E1",
    borderRadius: 12,
    backgroundColor: "#FFFFFF",
    paddingHorizontal: 12,
    paddingVertical: 12,
    fontSize: 15,
    color: "#0F172A",
  },
  sectionTitle: {
    color: "#0F172A",
    fontSize: 18,
    fontWeight: "900",
  },
  helperText: {
    color: "#475569",
    fontSize: 14,
  },
  stageLabel: {
    color: "#0F172A",
    fontSize: 16,
    fontWeight: "900",
  },
  primaryButton: {
    backgroundColor: "#F97316",
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: "center",
  },
  primaryButtonText: {
    color: "#FFFFFF",
    fontWeight: "900",
  },
  secondaryButton: {
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#CBD5E1",
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: "center",
  },
  secondaryButtonText: {
    color: "#334155",
    fontWeight: "800",
  },
  secondaryButtonDisabled: {
    opacity: 0.55,
  },
  stateCard: {
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#E2E8F0",
    borderRadius: 16,
    padding: 20,
    gap: 10,
    alignItems: "center",
  },
  stateTitle: {
    color: "#0F172A",
    fontSize: 18,
    fontWeight: "800",
    textAlign: "center",
  },
  stateText: {
    color: "#64748B",
    fontSize: 14,
    textAlign: "center",
  },
  noticeCard: {
    backgroundColor: "#FFF7ED",
    borderWidth: 1,
    borderColor: "#FED7AA",
    borderRadius: 16,
    padding: 14,
    gap: 6,
  },
  noticeText: {
    color: "#9A3412",
    fontWeight: "700",
  },
  otpCode: {
    color: "#7C2D12",
    fontSize: 28,
    fontWeight: "900",
    letterSpacing: 6,
  },
  eventRow: {
    borderTopWidth: 1,
    borderTopColor: "#F1F5F9",
    paddingTop: 10,
    gap: 2,
  },
  eventDate: {
    color: "#94A3B8",
    fontSize: 12,
  },
});
