import React, { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import OrderTimeline from "../components/OrderTimeline";
import { useAppShell } from "../context/AppShellContext";
import { fetchOrderTrackingSnapshot } from "../lib/orderTracking";
import {
  formatDateTime,
  paymentMethodLabel,
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
import { openSupportWhatsApp } from "../lib/supportWhatsApp";

export default function ConfirmationScreen({ route, navigation }) {
  const { selectedCity: shellCity, market } = useAppShell();
  const [liveSnapshot, setLiveSnapshot] = useState(null);
  const [loadingLive, setLoadingLive] = useState(false);
  const city = shellCity || route?.params?.city || null;
  const orderId = String(route?.params?.orderId || "").trim();
  const orderNumber = String(route?.params?.orderNumber || "").trim();
  const initialBusinessName = String(route?.params?.businessName || "").trim() || "Restaurant";
  const payment = liveSnapshot?.payment || route?.params?.payment || { method: "cash", status: "pending" };
  const totals = route?.params?.totals || null;
  const loyalty = route?.params?.loyalty || null;
  const currentStatus = String(liveSnapshot?.status || "new");
  const deliveryOtp = String(route?.params?.deliveryOtp || "").trim();
  const deliveryProof = liveSnapshot?.deliveryProof || route?.params?.deliveryProof || null;
  const businessName = getCustomerBusinessName(liveSnapshot?.businessName || initialBusinessName);
  const supportAvailability = useMemo(() => getSupportAvailability(market), [market]);
  const orderReference = getCustomerSafeOrderReference(liveSnapshot?.orderNumber || orderNumber);
  const paymentStatusLabel = getCustomerPaymentStatusLabel(payment, currentStatus, market);
  const deliveryPresentation = getCustomerDeliveryPresentation(
    {
      ...(liveSnapshot || {}),
      status: currentStatus,
    },
    market
  );
  const deliveryState = getDeliveryFinalizationState(
    {
      orderStatus: currentStatus,
      deliveryProof,
    },
    market
  );
  const visibleDeliveryOtp = getVisibleDeliveryOtp({
    deliveryOtp,
    orderStatus: currentStatus,
    deliveryProof,
  });
  const maskedDeliveryOtp = getMaskedDeliveryOtp(deliveryProof?.otpLast4);
  const canShowEta =
    Number.isFinite(Number(liveSnapshot?.etaMinutes)) &&
    !["cancelled", "delivered"].includes(deliveryPresentation.stageKey);
  const isSpanish = market.defaultLanguage === "es";
  const text = isSpanish
    ? {
        title: "Pedido confirmado",
        subtitle: `Enviamos tu pedido a ${businessName}.`,
        orderNumber: "Referencia del pedido",
        orderReferenceUnavailable: "Referencia pendiente",
        refreshing: "Actualizando estado en vivo...",
        status: "Estado",
        payment: "Pago",
        paidAt: "Pagado el",
        total: "Total",
        referralPending: "La recompensa de referido se liberara despues de una entrega exitosa.",
        loyaltyPending: "Puedes ganar",
        loyaltySuffix: "puntos despues de la entrega.",
        referralCode: "Codigo de referido usado",
        otpTitle: "Codigo de entrega",
        otpLast4: "Ultimos 4 digitos",
        verifiedAt: "Confirmado el",
        etaApprox: "ETA aprox.",
        track: "Seguir pedido",
        support: "Soporte por WhatsApp",
        supportUnavailable: "Soporte no disponible",
        continue: "Seguir explorando",
      }
    : {
        title: "Commande confirmee",
        subtitle: `Nous avons envoye ta commande a ${businessName}.`,
        orderNumber: "Reference de commande",
        orderReferenceUnavailable: "Reference en attente",
        refreshing: "Actualisation du statut en direct...",
        status: "Statut",
        payment: "Paiement",
        paidAt: "Paye le",
        total: "Total",
        referralPending: "La recompense de parrainage sera liberee apres une livraison reussie.",
        loyaltyPending: "Tu peux gagner",
        loyaltySuffix: "points apres la livraison.",
        referralCode: "Code de parrainage utilise",
        otpTitle: "Code de livraison",
        otpLast4: "4 derniers chiffres",
        verifiedAt: "Confirme le",
        etaApprox: "ETA approx.",
        track: "Suivre la commande",
        support: "Support WhatsApp",
        supportUnavailable: "Support indisponible",
        continue: "Continuer a explorer",
      };

  useEffect(() => {
    if (!orderId) return undefined;
    let mounted = true;

    async function load() {
      setLoadingLive(true);
      try {
        const snapshot = await fetchOrderTrackingSnapshot({
          orderId,
          orderNumber,
          businessName: initialBusinessName,
        });
        if (!mounted) return;
        setLiveSnapshot(snapshot);
      } catch {
        if (!mounted) return;
        setLiveSnapshot(null);
      } finally {
        if (mounted) setLoadingLive(false);
      }
    }

    load().catch(() => null);
    return () => {
      mounted = false;
    };
  }, [orderId]);

  const loyaltyMessage = useMemo(() => {
    if (!loyalty || ["delivered", "cancelled"].includes(currentStatus)) return "";
    if (loyalty?.referralRewardPending) {
      return text.referralPending;
    }
    if (Number(loyalty?.pendingPoints || 0) > 0) {
      return `${text.loyaltyPending} ${Number(loyalty.pendingPoints)} ${text.loyaltySuffix}`;
    }
    return "";
  }, [loyalty, text]);

  return (
    <ScrollView contentContainerStyle={styles.content}>
      <Text style={styles.title}>{text.title}</Text>
      <Text style={styles.subtitle}>{text.subtitle}</Text>

      <View style={styles.card}>
        <Text style={styles.label}>{text.orderNumber}</Text>
        <Text style={styles.value}>{orderReference || text.orderReferenceUnavailable}</Text>
        {loadingLive ? (
          <View style={styles.inlineLoading}>
            <ActivityIndicator color="#F97316" />
            <Text style={styles.helperText}>{text.refreshing}</Text>
          </View>
        ) : null}
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>{text.status}</Text>
        <Text style={styles.statusLabel}>{deliveryPresentation.label}</Text>
        {deliveryPresentation.hint ? (
          <Text style={styles.helperText}>{deliveryPresentation.hint}</Text>
        ) : null}
        <OrderTimeline status={currentStatus} city={city} rows={deliveryPresentation.timeline} />
        {canShowEta ? (
          <Text style={styles.helperText}>
            {text.etaApprox}: {Number(liveSnapshot?.etaMinutes)} min
          </Text>
        ) : null}
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>{text.payment}</Text>
        <Text style={styles.helperText}>
          {paymentMethodLabel(payment?.method, market)} | {paymentStatusLabel}
        </Text>
        {payment?.paidAt ? (
          <Text style={styles.helperText}>{text.paidAt} {formatDateTime(payment.paidAt, market)}</Text>
        ) : null}
        {totals?.total != null ? (
          <Text style={styles.helperText}>{text.total}: {formatPrice(totals.total, market)}</Text>
        ) : null}
      </View>

      {visibleDeliveryOtp || maskedDeliveryOtp || deliveryState?.label ? (
        <View style={styles.noticeCard}>
          <Text style={styles.sectionTitle}>{text.otpTitle}</Text>
          {deliveryState?.label ? <Text style={styles.noticeText}>{deliveryState.label}</Text> : null}
          {visibleDeliveryOtp ? <Text style={styles.otpCode}>{visibleDeliveryOtp}</Text> : null}
          {!visibleDeliveryOtp && maskedDeliveryOtp ? (
            <Text style={styles.helperText}>
              {text.otpLast4}: {maskedDeliveryOtp}
            </Text>
          ) : null}
          {deliveryState?.detail ? <Text style={styles.noticeText}>{deliveryState.detail}</Text> : null}
          {deliveryProof?.verifiedAt ? (
            <Text style={styles.helperText}>
              {text.verifiedAt} {formatDateTime(deliveryProof.verifiedAt, market)}
            </Text>
          ) : null}
        </View>
      ) : null}

      {loyaltyMessage ? (
        <View style={styles.noticeCard}>
          <Text style={styles.noticeText}>{loyaltyMessage}</Text>
          {loyalty?.referralCodeUsed ? (
            <Text style={styles.noticeText}>
              {text.referralCode}: {loyalty.referralCodeUsed}
            </Text>
          ) : null}
        </View>
      ) : null}

      <Pressable
        style={styles.primaryButton}
        onPress={() =>
          navigation.replace("Track", {
            orderId,
            orderNumber,
            businessName,
            deliveryOtp,
            deliveryProof,
          })
        }
      >
        <Text style={styles.primaryButtonText}>{text.track}</Text>
      </Pressable>

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

      <Pressable
        style={styles.secondaryButton}
        onPress={() => navigation.navigate("MainTabs", { screen: "Home" })}
      >
        <Text style={styles.secondaryButtonText}>{text.continue}</Text>
      </Pressable>
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
  label: {
    color: "#64748B",
    fontSize: 12,
  },
  value: {
    color: "#0F172A",
    fontSize: 22,
    fontWeight: "900",
  },
  sectionTitle: {
    color: "#0F172A",
    fontSize: 18,
    fontWeight: "900",
  },
  statusLabel: {
    color: "#0F172A",
    fontSize: 16,
    fontWeight: "900",
  },
  helperText: {
    color: "#475569",
    fontSize: 14,
  },
  inlineLoading: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
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
    fontSize: 14,
    fontWeight: "700",
  },
  otpCode: {
    color: "#7C2D12",
    fontSize: 28,
    fontWeight: "900",
    letterSpacing: 6,
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
});
