import { useEffect, useMemo, useRef, useState } from "react";
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  Vibration,
  View,
} from "react-native";

import OrangeButton from "@/src/components/OrangeButton";
import { colors } from "@/src/theme/colors";

function formatCurrency(amount, currencyCode = "XOF") {
  const currency = String(currencyCode || "XOF").trim().toUpperCase();
  const normalizedCurrency = currency === "DOP" || currency === "GBP" ? currency : "XOF";
  const locale =
    normalizedCurrency === "DOP" ? "es-DO" : normalizedCurrency === "GBP" ? "en-GB" : "fr-ML";
  const minimumFractionDigits = normalizedCurrency === "XOF" ? 0 : 2;
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: normalizedCurrency,
    minimumFractionDigits,
    maximumFractionDigits: minimumFractionDigits,
  }).format(Number(amount || 0));
}

async function playNotificationSound() {
  try {
    const expoAv = require("expo-av");
    if (!expoAv?.Audio?.Sound) return null;
    // No packaged merchant alert sound is wired yet. Skip safely until an asset is added.
    return null;
  } catch {
    return null;
  }
}

export default function NewOrderPopup({ order, onAccept, onReject }) {
  const [handledOrderIds, setHandledOrderIds] = useState([]);
  const [visibleOrderId, setVisibleOrderId] = useState("");
  const [secondsLeft, setSecondsLeft] = useState(30);
  const soundRef = useRef(null);

  const currentOrderId = String(order?.id || "").trim();
  const shouldShowOrder =
    order &&
    order.status === "new" &&
    currentOrderId &&
    !handledOrderIds.includes(currentOrderId);

  useEffect(() => {
    if (!shouldShowOrder || !currentOrderId) return undefined;

    setVisibleOrderId(currentOrderId);
    setSecondsLeft(30);
    Vibration.vibrate(400);

    playNotificationSound()
      .then((sound) => {
        soundRef.current = sound;
      })
      .catch(() => null);

    return () => {
      const sound = soundRef.current;
      soundRef.current = null;
      sound?.unloadAsync?.().catch(() => null);
    };
  }, [currentOrderId, shouldShowOrder]);

  useEffect(() => {
    if (!visibleOrderId || visibleOrderId !== currentOrderId) return undefined;

    const timer = setInterval(() => {
      setSecondsLeft((current) => {
        if (current <= 1) {
          setHandledOrderIds((rows) => (rows.includes(visibleOrderId) ? rows : [...rows, visibleOrderId]));
          setVisibleOrderId("");
          return 0;
        }
        return current - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [currentOrderId, visibleOrderId]);

  const isVisible = Boolean(visibleOrderId && currentOrderId === visibleOrderId && shouldShowOrder);
  const totalItems = useMemo(
    () => (Array.isArray(order?.items) ? order.items.reduce((sum, item) => sum + Number(item?.quantity || 0), 0) : 0),
    [order]
  );

  async function handleAccept() {
    if (!order) return;
    setHandledOrderIds((rows) => (rows.includes(order.id) ? rows : [...rows, order.id]));
    setVisibleOrderId("");
    await onAccept?.(order);
  }

  async function handleReject() {
    if (!order) return;
    setHandledOrderIds((rows) => (rows.includes(order.id) ? rows : [...rows, order.id]));
    setVisibleOrderId("");
    await onReject?.(order);
  }

  function handleDismiss() {
    if (!order?.id) {
      setVisibleOrderId("");
      return;
    }
    setHandledOrderIds((rows) => (rows.includes(order.id) ? rows : [...rows, order.id]));
    setVisibleOrderId("");
  }

  return (
    <Modal visible={isVisible} transparent animationType="fade">
      <View style={styles.overlay}>
        <View style={styles.modalCard}>
          <View style={styles.hero}>
            <Text style={styles.heroEyebrow}>New order</Text>
            <Text style={styles.heroTitle}>{order?.orderNumber || "Incoming order"}</Text>
            <Text style={styles.heroTimer}>{secondsLeft}s</Text>
          </View>

          <ScrollView contentContainerStyle={styles.content}>
            <View style={styles.summaryCard}>
              <InfoRow label="Customer" value={order?.customerName || "Customer"} />
              <InfoRow label="Items" value={`${totalItems} item${totalItems === 1 ? "" : "s"}`} />
              <InfoRow
                label="Payment"
                value={`${String(order?.paymentMethod || "cash")} / ${String(order?.paymentStatus || "pending")}`}
              />
              <InfoRow label="Delivery mode" value={String(order?.deliveryMode || "self_delivery")} />
            </View>

            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Items</Text>
              {(order?.items || []).map((item) => (
                <View key={item.id} style={styles.itemRow}>
                  <Text style={styles.itemText}>
                    {item.name} x{item.quantity}
                  </Text>
                  <Text style={styles.itemPrice}>
                    {formatCurrency(Number(item.quantity || 0) * Number(item.price || 0), order?.currencyCode)}
                  </Text>
                </View>
              ))}
            </View>

            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Delivery</Text>
              <Text style={styles.addressText}>{order?.address || "Address unavailable"}</Text>
              {order?.deliveryNote ? <Text style={styles.noteText}>{order.deliveryNote}</Text> : null}
            </View>

            <View style={styles.totalRow}>
              <Text style={styles.totalLabel}>Total</Text>
              <Text style={styles.totalValue}>{formatCurrency(order?.total || 0, order?.currencyCode)}</Text>
            </View>
          </ScrollView>

          <View style={styles.actionRow}>
            <OrangeButton label="Reject Order" variant="outline" onPress={handleReject} style={styles.actionButton} />
            <OrangeButton label="Accept Order" onPress={handleAccept} style={styles.actionButton} />
          </View>

          <Pressable onPress={handleDismiss} style={styles.dismissButton}>
            <Text style={styles.dismissText}>Dismiss</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

function InfoRow({ label, value }) {
  return (
    <View style={styles.infoRow}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(17,17,17,0.58)",
    justifyContent: "flex-end",
  },
  modalCard: {
    maxHeight: "92%",
    backgroundColor: colors.card,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    overflow: "hidden",
  },
  hero: {
    backgroundColor: colors.primary,
    paddingHorizontal: 22,
    paddingTop: 26,
    paddingBottom: 22,
    gap: 4,
  },
  heroEyebrow: {
    color: "#FFE7D6",
    fontSize: 13,
    fontWeight: "800",
    textTransform: "uppercase",
  },
  heroTitle: {
    color: "#FFFFFF",
    fontSize: 28,
    fontWeight: "900",
  },
  heroTimer: {
    color: "#FFFFFF",
    fontSize: 24,
    fontWeight: "900",
  },
  content: {
    padding: 20,
    gap: 16,
  },
  summaryCard: {
    backgroundColor: colors.surfaceAlt,
    borderRadius: 22,
    padding: 16,
    gap: 10,
  },
  infoRow: {
    gap: 4,
  },
  infoLabel: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "800",
    textTransform: "uppercase",
  },
  infoValue: {
    color: colors.text,
    fontSize: 15,
    fontWeight: "700",
  },
  section: {
    gap: 10,
  },
  sectionTitle: {
    color: colors.text,
    fontSize: 18,
    fontWeight: "900",
  },
  itemRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 12,
  },
  itemText: {
    flex: 1,
    color: colors.text,
    fontSize: 14,
    fontWeight: "700",
  },
  itemPrice: {
    color: colors.text,
    fontSize: 14,
    fontWeight: "800",
  },
  addressText: {
    color: colors.text,
    fontSize: 15,
    fontWeight: "700",
    lineHeight: 22,
  },
  noteText: {
    color: colors.muted,
    fontSize: 13,
    lineHeight: 18,
  },
  totalRow: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: 16,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  totalLabel: {
    color: colors.text,
    fontSize: 18,
    fontWeight: "800",
  },
  totalValue: {
    color: colors.text,
    fontSize: 24,
    fontWeight: "900",
  },
  actionRow: {
    flexDirection: "row",
    gap: 10,
    paddingHorizontal: 20,
    paddingBottom: 12,
  },
  actionButton: {
    flex: 1,
  },
  dismissButton: {
    alignItems: "center",
    paddingBottom: 22,
  },
  dismissText: {
    color: colors.muted,
    fontWeight: "700",
  },
});
