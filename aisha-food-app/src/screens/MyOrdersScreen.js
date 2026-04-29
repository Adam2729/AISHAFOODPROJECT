import AsyncStorage from "@react-native-async-storage/async-storage";
import React, { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { useAppShell } from "../context/AppShellContext";
import { apiGet, apiPost } from "../lib/api";
import { getProductSizeLabel } from "../lib/catalogPresentation";
import { enrichHistoryOrder } from "../lib/orderTracking";
import { getOrCreateSessionId } from "../lib/sessionId";
import { ensureUserSession } from "../lib/userProfile";
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
  getSupportAvailability,
} from "../lib/orderPresentation";
import { openSupportWhatsApp } from "../lib/supportWhatsApp";

const SAVED_CUSTOMER_KEY = "aisha_saved_customer";

function normalizePhone(value) {
  return String(value || "").replace(/\D+/g, "").trim();
}

export default function MyOrdersScreen({ navigation }) {
  const { selectedCity: city, market } = useAppShell();
  const [phone, setPhone] = useState("");
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(false);
  const [reorderLoadingId, setReorderLoadingId] = useState("");
  const [error, setError] = useState("");
  const supportAvailability = useMemo(() => getSupportAvailability(market), [market]);
  const isSpanish = market.defaultLanguage === "es";
  const text = isSpanish
    ? {
        title: "Mis pedidos",
        subtitle: "Consulta tus pedidos recientes con acceso verificado desde este mismo dispositivo.",
        phonePlaceholder: "Numero de telefono",
        load: "Cargar mis pedidos",
        loading: "Cargando...",
        missingPhone: "Ingresa tu numero para verificar y cargar tu historial.",
        verificationRequired: "Verifica desde el mismo dispositivo usado en checkout para ver tu historial.",
        loadError: "No fue posible cargar el historial de pedidos.",
        reorder: "Repetir pedido",
        reorderNeedsPhone: "Ingresa primero tu numero.",
        reorderError: "No fue posible preparar el nuevo pedido.",
        noOrders: "No se encontraron pedidos",
        noOrdersBody: "Cuando hagas tu primer pedido, aparecera aqui.",
        loadingOrders: "Cargando pedidos...",
        order: "Referencia",
        orderReferenceUnavailable: "Referencia pendiente",
        status: "Estado",
        payment: "Pago",
        total: "Total",
        track: "Seguir",
        support: "Soporte por WhatsApp",
        supportUnavailable: "Soporte no disponible",
        items: "Articulos",
      }
    : {
        title: "Mes commandes",
        subtitle: "Retrouve tes commandes recentes avec un acces verifie depuis ce meme appareil.",
        phonePlaceholder: "Numero de telephone",
        load: "Charger mes commandes",
        loading: "Chargement...",
        missingPhone: "Entre ton numero pour verifier et charger ton historique.",
        verificationRequired: "Verifie depuis l'appareil utilise au checkout pour voir ton historique.",
        loadError: "Impossible de charger l'historique des commandes.",
        reorder: "Recommander",
        reorderNeedsPhone: "Entre d'abord ton numero.",
        reorderError: "Impossible de preparer la nouvelle commande.",
        noOrders: "Aucune commande trouvee",
        noOrdersBody: "Une fois ta commande passee, elle apparaitra ici.",
        loadingOrders: "Chargement des commandes...",
        order: "Reference",
        orderReferenceUnavailable: "Reference en attente",
        status: "Statut",
        payment: "Paiement",
        total: "Total",
        track: "Suivre",
        support: "Support WhatsApp",
        supportUnavailable: "Support indisponible",
        items: "Articles",
      };

  useEffect(() => {
    let mounted = true;

    Promise.all([AsyncStorage.getItem(SAVED_CUSTOMER_KEY)])
      .then(async ([raw]) => {
        if (!mounted) return;
        if (!raw) return;
        const saved = JSON.parse(raw);
        const savedPhone = normalizePhone(saved?.phone);
        if (!savedPhone) return;
        setPhone(savedPhone);
        await loadOrders(savedPhone);
      })
      .catch(() => null);

    return () => {
      mounted = false;
    };
  }, []);

  useFocusEffect(
    React.useCallback(() => {
      if (!phone) return undefined;
      loadOrders(phone).catch(() => null);
      return undefined;
    }, [phone])
  );

  async function persistPhone(nextPhone) {
    const raw = await AsyncStorage.getItem(SAVED_CUSTOMER_KEY);
    const existing = raw ? JSON.parse(raw) : {};
    await AsyncStorage.setItem(
      SAVED_CUSTOMER_KEY,
      JSON.stringify({
        ...existing,
        phone: normalizePhone(nextPhone),
        updatedAt: new Date().toISOString(),
      })
    );
  }

  async function loadOrders(phoneValue) {
    const safePhone = normalizePhone(phoneValue || phone);
    if (!safePhone) {
      Alert.alert(text.title, text.missingPhone);
      return;
    }

    setLoading(true);
    setError("");
    try {
      const sessionId = await getOrCreateSessionId();
      const sessionToken = await ensureUserSession(safePhone);
      const access = await apiPost(
        "/api/public/orders/history/access",
        { phone: safePhone },
        {
          headers: {
            "x-user-session": sessionToken,
            "x-session-id": sessionId,
          },
        }
      );
      const accessToken = String(access?.accessToken || "").trim();
      if (!accessToken) {
        throw new Error(text.verificationRequired);
      }
      const response = await apiGet(
        `/api/public/orders/history?phone=${encodeURIComponent(safePhone)}&limit=10`,
        {
          headers: {
            "x-user-session": sessionToken,
            "x-order-history-token": accessToken,
          },
        }
      );
      const rows = Array.isArray(response?.orders) ? response.orders : [];
      const enriched = await Promise.all(rows.map((row) => enrichHistoryOrder(row)));
      setOrders(enriched);
      await persistPhone(safePhone);
    } catch (requestError) {
      setOrders([]);
      setError(requestError?.message || text.loadError);
    } finally {
      setLoading(false);
    }
  }

  async function handleReorder(order) {
    const safePhone = normalizePhone(phone);
    if (!safePhone) {
      Alert.alert(text.reorder, text.reorderNeedsPhone);
      return;
    }

    const rowId = String(order?.orderId || order?.orderNumber || "");
    setReorderLoadingId(rowId);
    try {
      const draft = await apiPost("/api/public/orders/reorder", {
        phone: safePhone,
        ...(order?.orderId ? { orderId: order.orderId } : { orderNumber: order.orderNumber }),
      });
      navigation.navigate("Cart", { reorderDraft: draft });
    } catch (requestError) {
      Alert.alert(text.reorder, requestError?.message || text.reorderError);
    } finally {
      setReorderLoadingId("");
    }
  }

  return (
    <View style={styles.safeArea}>
      <Text style={styles.title}>{text.title}</Text>
      <Text style={styles.subtitle}>{text.subtitle}</Text>

      <TextInput
        value={phone}
        onChangeText={setPhone}
        placeholder={text.phonePlaceholder}
        placeholderTextColor="#94A3B8"
        keyboardType="phone-pad"
        style={styles.input}
      />

      <Pressable style={styles.primaryButton} onPress={() => loadOrders(phone)}>
        <Text style={styles.primaryButtonText}>{loading ? text.loading : text.load}</Text>
      </Pressable>

      {error ? <Text style={styles.errorText}>{error}</Text> : null}

      <FlatList
        data={orders}
        keyExtractor={(item, index) => String(item?.orderId || item?.orderNumber || `order-${index}`)}
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={
          loading ? (
            <View style={styles.stateCard}>
              <ActivityIndicator color="#F97316" />
              <Text style={styles.stateText}>{text.loadingOrders}</Text>
            </View>
          ) : (
            <View style={styles.stateCard}>
              <Text style={styles.stateTitle}>{text.noOrders}</Text>
              <Text style={styles.stateText}>{text.noOrdersBody}</Text>
            </View>
          )
        }
        renderItem={({ item }) => {
          const rowId = String(item?.orderId || item?.orderNumber || "");
          const payment = item?.payment || null;
          const busy = reorderLoadingId === rowId;
          const orderReference = getCustomerSafeOrderReference(item?.orderNumber);
          const businessName = getCustomerBusinessName(item?.businessName || item?.business?.businessName);
          const paymentStatusLabel = getCustomerPaymentStatusLabel(payment, item?.status, market);
          const deliveryPresentation = getCustomerDeliveryPresentation(item, market);

          return (
            <View style={styles.orderCard}>
              <Text style={styles.orderBusiness}>{businessName}</Text>
              <Text style={styles.orderMeta}>
                {text.order}: {orderReference || text.orderReferenceUnavailable}
              </Text>
              <Text style={styles.orderMeta}>{text.status}: {deliveryPresentation.label}</Text>
              {deliveryPresentation.hint &&
              !["cancelled", "delivered"].includes(deliveryPresentation.stageKey) ? (
                <Text style={styles.orderHint}>{deliveryPresentation.hint}</Text>
              ) : null}
              {payment ? (
                <Text style={styles.orderMeta}>
                  {text.payment}: {paymentMethodLabel(payment?.method, market)} | {paymentStatusLabel}
                </Text>
              ) : null}
              <Text style={styles.orderMeta}>
                {text.total}: {formatPrice(item?.totals?.total || 0, market)}
              </Text>
              {Array.isArray(item?.itemsSummary) && item.itemsSummary.length ? (
                <View style={styles.itemsSummary}>
                  <Text style={styles.itemsSummaryTitle}>{text.items}</Text>
                  {item.itemsSummary.slice(0, 4).map((orderItem, index) => {
                    const sizeLabel = getProductSizeLabel(orderItem);
                    return (
                      <Text
                        key={`${String(orderItem?.name || "item")}-${index}`}
                        style={styles.itemsSummaryRow}
                      >
                        {Number(orderItem?.qty || 1)} x {String(orderItem?.name || "Menu item")}
                        {sizeLabel ? ` (${sizeLabel})` : ""}
                      </Text>
                    );
                  })}
                </View>
              ) : null}
              <Text style={styles.orderDate}>{formatDateTime(item?.createdAt, market)}</Text>

              <View style={styles.actionRow}>
                <Pressable
                  style={styles.actionButton}
                  onPress={() =>
                    navigation.navigate("Track", {
                      orderId: item?.orderId,
                      orderNumber: item?.orderNumber,
                      businessName: item?.businessName,
                    })
                  }
                >
                  <Text style={styles.actionButtonText}>{text.track}</Text>
                </Pressable>

                <Pressable
                  style={[styles.actionButton, busy && styles.actionButtonBusy]}
                  disabled={busy}
                  onPress={() => handleReorder(item)}
                >
                  <Text style={styles.actionButtonText}>{busy ? "..." : text.reorder}</Text>
                </Pressable>
              </View>

              <Pressable
                style={[styles.supportButton, !supportAvailability.configured && styles.supportButtonDisabled]}
                disabled={!supportAvailability.configured}
                onPress={() =>
                  openSupportWhatsApp({
                    orderNumber: orderReference,
                    businessName,
                    city,
                  })
                }
              >
                <Text style={styles.supportButtonText}>
                  {supportAvailability.configured ? text.support : text.supportUnavailable}
                </Text>
              </Pressable>
            </View>
          );
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: "#F8FAFC",
    padding: 16,
    gap: 12,
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
  errorText: {
    color: "#B91C1C",
  },
  listContent: {
    paddingBottom: 24,
    flexGrow: 1,
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
  orderCard: {
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#E2E8F0",
    borderRadius: 16,
    padding: 14,
    gap: 6,
    marginBottom: 12,
  },
  orderBusiness: {
    color: "#0F172A",
    fontSize: 17,
    fontWeight: "900",
  },
  orderMeta: {
    color: "#475569",
    fontSize: 14,
  },
  orderHint: {
    color: "#64748B",
    fontSize: 12,
  },
  orderDate: {
    color: "#94A3B8",
    fontSize: 12,
  },
  itemsSummary: {
    marginTop: 4,
    gap: 2,
  },
  itemsSummaryTitle: {
    color: "#334155",
    fontSize: 12,
    fontWeight: "900",
  },
  itemsSummaryRow: {
    color: "#64748B",
    fontSize: 12,
  },
  actionRow: {
    flexDirection: "row",
    gap: 8,
    marginTop: 6,
  },
  actionButton: {
    flex: 1,
    backgroundColor: "#0F172A",
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: "center",
  },
  actionButtonBusy: {
    backgroundColor: "#64748B",
  },
  actionButtonText: {
    color: "#FFFFFF",
    fontWeight: "800",
  },
  supportButton: {
    marginTop: 4,
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#CBD5E1",
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: "center",
  },
  supportButtonText: {
    color: "#334155",
    fontWeight: "800",
  },
  supportButtonDisabled: {
    opacity: 0.55,
  },
});
